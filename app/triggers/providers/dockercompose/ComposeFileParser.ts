import fs from 'node:fs/promises';
import yaml, { type Pair, type ParsedNode } from 'yaml';
import { getErrorMessage } from '../../../util/error.js';

export const YAML_MAX_ALIAS_COUNT = 10_000;
export const COMPOSE_CACHE_MAX_ENTRIES = 256;

type ComposeTextEdit = {
  start: number;
  end: number;
  text: string;
};

type ComposeParserLog = {
  error?: (message: string) => void;
};

export interface ComposeFileParserOptions {
  resolveComposeFilePath: (file: string) => string;
  getDefaultComposeFilePath?: () => string | null | undefined;
  getLog?: () => ComposeParserLog | undefined;
  composeCacheMaxEntries?: number;
}

function getLineStartOffset(text: string, offset: number) {
  const beforeOffset = Math.max(0, offset - 1);
  return text.lastIndexOf('\n', beforeOffset) + 1;
}

function getLineIndentationAtOffset(text: string, offset: number) {
  const lineStart = getLineStartOffset(text, offset);
  return text.slice(lineStart, offset);
}

function getPreferredChildIndentation(parentIndentation: string) {
  return `${parentIndentation}  `;
}

function getMapPairByKey(
  mapNode: unknown,
  keyName: string,
): Pair<ParsedNode | null, ParsedNode | null> | undefined {
  return (mapNode as { items: Pair<ParsedNode | null, ParsedNode | null>[] }).items.find(
    (pair): pair is Pair<ParsedNode | null, ParsedNode | null> => {
      const pairKeyValue = (pair?.key as { value?: unknown })?.value;
      return `${pairKeyValue}` === keyName;
    },
  );
}

function formatReplacementImageValue(currentImageValueText: string, newImage: string) {
  if (currentImageValueText.startsWith("'") && currentImageValueText.endsWith("'")) {
    return `'${newImage.replace(/'/g, "''")}'`;
  }
  if (currentImageValueText.startsWith('"') && currentImageValueText.endsWith('"')) {
    return JSON.stringify(newImage);
  }
  return newImage;
}

function parseComposeDocument(composeFileText: string) {
  const parseDocumentOptions = {
    keepSourceTokens: true,
    maxAliasCount: YAML_MAX_ALIAS_COUNT,
  };
  const composeDoc = yaml.parseDocument(composeFileText, {
    ...(parseDocumentOptions as unknown as { keepSourceTokens: true }),
  });
  if (composeDoc.errors?.length > 0) {
    throw composeDoc.errors[0];
  }
  return composeDoc;
}

type ComposeDocument = ReturnType<typeof parseComposeDocument>;

function buildComposeServiceImageTextEdit(
  composeFileText: string,
  composeDoc: ComposeDocument,
  serviceName: string,
  newImage: string,
): ComposeTextEdit {
  const newline = composeFileText.includes('\r\n') ? '\r\n' : '\n';
  const servicesNode = composeDoc.get('services', true);
  if (!yaml.isMap(servicesNode)) {
    throw new Error('Unable to locate services section in compose file');
  }

  const servicePair = getMapPairByKey(servicesNode, serviceName);
  if (!servicePair) {
    throw new Error(`Unable to locate compose service ${serviceName}`);
  }

  const serviceValueNode = servicePair.value;
  if (yaml.isMap(serviceValueNode)) {
    const imagePair = getMapPairByKey(serviceValueNode, 'image');
    if (imagePair) {
      const imageValueRange = imagePair.value!.range!;
      const imageValueStart = imageValueRange[0];
      const imageValueEnd = imageValueRange[1];
      const currentImageValueText = composeFileText.slice(imageValueStart, imageValueEnd);
      const formattedImage = formatReplacementImageValue(currentImageValueText, newImage);
      return {
        start: imageValueStart,
        end: imageValueEnd,
        text: formattedImage,
      };
    }

    if (serviceValueNode?.srcToken?.type === 'flow-collection') {
      throw new Error(
        `Unable to insert compose image for flow-style service ${serviceName} without image key`,
      );
    }
  } else if (!(yaml.isScalar(serviceValueNode) && serviceValueNode.value === null)) {
    throw new Error(`Unable to patch compose service ${serviceName} because it is not a map`);
  }

  const serviceKeyOffset = servicePair.key!.range![0];
  const serviceIndentation = getLineIndentationAtOffset(composeFileText, serviceKeyOffset);
  const imageIndentation = getPreferredChildIndentation(serviceIndentation);
  const lineBreakOffset = composeFileText.indexOf('\n', serviceKeyOffset);

  if (lineBreakOffset >= 0) {
    const insertionOffset = lineBreakOffset + 1;
    return {
      start: insertionOffset,
      end: insertionOffset,
      text: `${imageIndentation}image: ${newImage}${newline}`,
    };
  }

  return {
    start: composeFileText.length,
    end: composeFileText.length,
    text: `${newline}${imageIndentation}image: ${newImage}`,
  };
}

function applyComposeTextEdits(composeFileText: string, composeTextEdits: ComposeTextEdit[]) {
  const sortedEdits = [...composeTextEdits].sort(
    (left, right) => right.start - left.start || right.end - left.end,
  );
  let lastAppliedStart = composeFileText.length;
  let updatedComposeText = composeFileText;
  for (const composeTextEdit of sortedEdits) {
    if (composeTextEdit.end > lastAppliedStart) {
      throw new Error('Unable to apply overlapping compose edits');
    }
    updatedComposeText = `${updatedComposeText.slice(0, composeTextEdit.start)}${composeTextEdit.text}${updatedComposeText.slice(composeTextEdit.end)}`;
    lastAppliedStart = composeTextEdit.start;
  }
  return updatedComposeText;
}

/**
 * Update only one compose service image line while preserving original
 * formatting, comments, and key ordering elsewhere in the file.
 */
export function updateComposeServiceImageInText(
  composeFileText: string,
  serviceName: string,
  newImage: string,
  composeDoc: ComposeDocument | null = null,
) {
  const doc = composeDoc || parseComposeDocument(composeFileText);
  const composeTextEdit = buildComposeServiceImageTextEdit(
    composeFileText,
    doc,
    serviceName,
    newImage,
  );
  return applyComposeTextEdits(composeFileText, [composeTextEdit]);
}

export function updateComposeServiceImagesInText(
  composeFileText: string,
  serviceImageUpdates: Map<string, string>,
  composeDoc: ComposeDocument | null = null,
) {
  if (serviceImageUpdates.size === 0) {
    return composeFileText;
  }
  const doc = composeDoc || parseComposeDocument(composeFileText);
  const composeTextEdits: ComposeTextEdit[] = [];
  for (const [serviceName, newImage] of serviceImageUpdates.entries()) {
    composeTextEdits.push(
      buildComposeServiceImageTextEdit(composeFileText, doc, serviceName, newImage),
    );
  }
  return applyComposeTextEdits(composeFileText, composeTextEdits);
}

class ComposeFileParser {
  _composeCacheMaxEntries = COMPOSE_CACHE_MAX_ENTRIES;
  _composeObjectCache = new Map<string, { mtimeMs: number; compose: unknown }>();
  _composeDocumentCache = new Map<string, { mtimeMs: number; composeDoc: ComposeDocument }>();

  private readonly resolveComposeFilePath: (file: string) => string;
  private readonly getDefaultComposeFilePath: () => string | null | undefined;
  private readonly getLog: () => ComposeParserLog | undefined;

  constructor(options: ComposeFileParserOptions) {
    if (typeof options?.resolveComposeFilePath !== 'function') {
      throw new TypeError('ComposeFileParser requires dependency "resolveComposeFilePath"');
    }

    this.resolveComposeFilePath = options.resolveComposeFilePath;
    this.getDefaultComposeFilePath = options.getDefaultComposeFilePath || (() => null);
    this.getLog = options.getLog || (() => undefined);

    if (typeof options.composeCacheMaxEntries === 'number') {
      this._composeCacheMaxEntries = options.composeCacheMaxEntries;
    }
  }

  setComposeCacheMaxEntries(maxEntries: number) {
    this._composeCacheMaxEntries = maxEntries;
    if (this._composeCacheMaxEntries < 1) {
      this._composeObjectCache.clear();
      this._composeDocumentCache.clear();
      return;
    }

    while (this._composeObjectCache.size > this._composeCacheMaxEntries) {
      const oldestCacheKey = this._composeObjectCache.keys().next().value;
      this._composeObjectCache.delete(oldestCacheKey);
    }
    while (this._composeDocumentCache.size > this._composeCacheMaxEntries) {
      const oldestCacheKey = this._composeDocumentCache.keys().next().value;
      this._composeDocumentCache.delete(oldestCacheKey);
    }
  }

  invalidateComposeCaches(filePath: string) {
    this._composeObjectCache.delete(filePath);
    this._composeDocumentCache.delete(filePath);
  }

  setComposeCacheEntry(
    cache: Map<
      string,
      { mtimeMs: number; compose: unknown } | { mtimeMs: number; composeDoc: unknown }
    >,
    filePath: string,
    value: { mtimeMs: number; compose: unknown } | { mtimeMs: number; composeDoc: unknown },
  ) {
    if (this._composeCacheMaxEntries < 1) {
      cache.clear();
      return;
    }
    if (cache.has(filePath)) {
      cache.delete(filePath);
    }
    cache.set(filePath, value);
    while (cache.size > this._composeCacheMaxEntries) {
      const oldestCacheKey = cache.keys().next().value;
      cache.delete(oldestCacheKey);
    }
  }

  getCachedComposeDocument(filePath: string, mtimeMs: number, composeFileText: string) {
    const cachedComposeDocument = this._composeDocumentCache.get(filePath);
    if (cachedComposeDocument && cachedComposeDocument.mtimeMs === mtimeMs) {
      this.setComposeCacheEntry(this._composeDocumentCache, filePath, cachedComposeDocument);
      return cachedComposeDocument.composeDoc;
    }
    const composeDoc = parseComposeDocument(composeFileText);
    this.setComposeCacheEntry(this._composeDocumentCache, filePath, {
      mtimeMs,
      composeDoc,
    });
    return composeDoc;
  }

  /**
   * Read docker-compose file as a buffer.
   * @param file - Optional file path, defaults to configuration file
   * @returns {Promise<Buffer>}
   */
  getComposeFile(file: string | null = null) {
    const configuredFilePath = file || this.getDefaultComposeFilePath();
    const filePath = this.resolveComposeFilePath(configuredFilePath as string);
    try {
      return fs.readFile(filePath);
    } catch (e: unknown) {
      this.getLog()?.error?.(
        `Error when reading the docker-compose yaml file ${filePath} (${getErrorMessage(e, String(e))})`,
      );
      throw e;
    }
  }

  /**
   * Read docker-compose file as an object.
   * @param file - Optional file path, defaults to configuration file
   * @returns {Promise<unknown>}
   */
  async getComposeFileAsObject(file: string | null = null) {
    const configuredFilePath = file || this.getDefaultComposeFilePath();
    try {
      const filePath = this.resolveComposeFilePath(configuredFilePath as string);
      const composeFileStat = await fs.stat(filePath);
      const cachedComposeObject = this._composeObjectCache.get(filePath);
      if (cachedComposeObject && cachedComposeObject.mtimeMs === composeFileStat.mtimeMs) {
        this.setComposeCacheEntry(this._composeObjectCache, filePath, cachedComposeObject);
        return cachedComposeObject.compose;
      }
      const compose = yaml.parse((await this.getComposeFile(filePath)).toString(), {
        maxAliasCount: YAML_MAX_ALIAS_COUNT,
      });
      this.setComposeCacheEntry(this._composeObjectCache, filePath, {
        mtimeMs: composeFileStat.mtimeMs,
        compose,
      });
      return compose;
    } catch (e: unknown) {
      this.getLog()?.error?.(
        `Error when parsing the docker-compose yaml file ${configuredFilePath} (${getErrorMessage(
          e,
          String(e),
        )})`,
      );
      throw e;
    }
  }
}

export default ComposeFileParser;
