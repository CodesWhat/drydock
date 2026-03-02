import path from 'node:path';
import type { Request, Response } from 'express';
import { providers } from './icons.providers.js';
import {
  CACHE_CONTROL_HEADER,
  FALLBACK_ICON,
  FALLBACK_IMAGE_PROVIDER,
  FALLBACK_IMAGE_SLUG,
} from './icons.settings.js';
import { findBundledIconPath } from './icons.storage.js';

function sendCachedIcon(res: Response, iconPath: string, contentType: string) {
  res.set('Cache-Control', CACHE_CONTROL_HEADER);
  res.type(contentType);
  res.sendFile(path.basename(iconPath), { root: path.dirname(iconPath) });
}

function shouldServeImageFallback(req: Request): boolean {
  const fetchDestination = req?.headers?.['sec-fetch-dest'];
  const fetchDestinationValue = Array.isArray(fetchDestination)
    ? fetchDestination.join(',')
    : fetchDestination;
  if (
    typeof fetchDestinationValue === 'string' &&
    fetchDestinationValue.toLowerCase() === 'image'
  ) {
    return true;
  }

  const acceptHeader = req?.headers?.accept;
  const acceptHeaderValue = Array.isArray(acceptHeader) ? acceptHeader.join(',') : acceptHeader;
  return (
    typeof acceptHeaderValue === 'string' && acceptHeaderValue.toLowerCase().includes('image/')
  );
}

async function sendMissingIconResponse({
  req,
  res,
  errorMessage,
}: {
  req: Request;
  res: Response;
  errorMessage: string;
}) {
  if (shouldServeImageFallback(req)) {
    const fallbackPath = await findBundledIconPath(
      FALLBACK_IMAGE_PROVIDER,
      FALLBACK_IMAGE_SLUG,
      providers[FALLBACK_IMAGE_PROVIDER].extension,
    );
    if (fallbackPath) {
      sendCachedIcon(res, fallbackPath, providers[FALLBACK_IMAGE_PROVIDER].contentType);
      return;
    }
  }

  res.status(404).json({
    error: errorMessage,
    fallbackIcon: FALLBACK_ICON,
  });
}

export { sendCachedIcon, sendMissingIconResponse };
