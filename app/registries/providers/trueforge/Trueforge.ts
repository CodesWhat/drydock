import type { ContainerImage } from '../../../model/container.js';
import Quay from '../quay/Quay.js';

interface TrueforgeImageLike {
  registry?: {
    url?: unknown;
  };
}

interface TrueforgeConfiguration {
  username?: string;
  token?: string;
}

interface TrueforgePullCredentials {
  username: string;
  password: string;
}

/**
 * Linux-Server Container Registry integration.
 */
class Trueforge extends Quay {
  getConfigurationSchema() {
    return this.joi.alternatives([
      // Anonymous configuration
      this.joi.string().allow(''),

      // Auth configuration (username + token, unlike Quay's namespace + account)
      this.joi.object().keys({
        username: this.joi.string().required(),
        token: this.joi.string().required(),
      }),
    ]);
  }

  /**
   * Return true if image has not registry url.
   * @param image the image
   * @returns {boolean}
   */

  match(image: TrueforgeImageLike): boolean {
    const url = image?.registry?.url;
    if (typeof url !== 'string') {
      return false;
    }
    return (
      url === 'oci.trueforge.org' ||
      (url.endsWith('.oci.trueforge.org') && /^[a-zA-Z0-9.-]+$/.test(url))
    );
  }

  /**
   * Normalize image according to Trueforge registry characteristics.
   * @param image
   * @returns {*}
   */

  normalizeImage(image: ContainerImage): ContainerImage {
    return this.normalizeImageUrl(image);
  }

  /**
   * Return Base64 credentials when configured.
   * @returns {string|undefined}
   */
  getAuthCredentials(): string | undefined {
    const configuration = this.configuration as TrueforgeConfiguration;
    if (configuration.username) {
      return Trueforge.base64Encode(configuration.username, configuration.token as string);
    }
    return undefined;
  }

  /**
   * Return username / password for Docker(+compose) triggers usage.
   * @return {{password: string, username: string}|undefined}
   */
  async getAuthPull(): Promise<TrueforgePullCredentials | undefined> {
    const configuration = this.configuration as TrueforgeConfiguration;
    if (configuration.username) {
      return {
        username: configuration.username,
        password: configuration.token as string,
      };
    }
    return undefined;
  }
}

export default Trueforge;
