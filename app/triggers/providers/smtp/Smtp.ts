import nodemailer, { type Transporter } from 'nodemailer';
import Trigger, { type TriggerConfiguration } from '../Trigger.js';

interface SmtpConfiguration extends TriggerConfiguration {
  host: string;
  allowcustomtld: boolean;
  port: number;
  user?: string;
  pass?: string;
  from: string;
  to: string;
  tls: {
    enabled: boolean;
    verify: boolean;
  };
}

/**
 * SMTP Trigger implementation
 */
class Smtp extends Trigger<SmtpConfiguration> {
  private transporter!: Transporter;

  normalizeFromAddress(value, allowCustomTld) {
    if (value.includes('\n') || value.includes('\r')) {
      return null;
    }

    let displayName;
    let emailAddress = value;

    const displayNameSeparatorIndex = value.lastIndexOf(' <');
    if (displayNameSeparatorIndex !== -1) {
      displayName = value.slice(0, displayNameSeparatorIndex);
      emailAddress = value.slice(displayNameSeparatorIndex + 2);
    }

    if (emailAddress.endsWith('>')) {
      emailAddress = emailAddress.slice(0, -1);
    }

    if (
      !emailAddress ||
      emailAddress.includes(' ') ||
      emailAddress.includes('<') ||
      emailAddress.includes('>')
    ) {
      return null;
    }

    const emailValidationResult = this.joi
      .string()
      .email({ tlds: { allow: !allowCustomTld } })
      .validate(emailAddress);
    if (emailValidationResult.error) {
      return null;
    }

    if (!displayName) {
      return emailAddress;
    }

    if (displayName.startsWith('"')) {
      displayName = displayName.slice(1);
    }
    if (displayName.endsWith('"')) {
      displayName = displayName.slice(0, -1);
    }

    if (!displayName) {
      return emailAddress;
    }

    if (displayName.includes('"')) {
      return null;
    }

    return `"${displayName}" <${emailAddress}>`;
  }

  /**
   * Get the Trigger configuration schema.
   * @returns {*}
   */
  getConfigurationSchema() {
    return this.joi.object().keys({
      host: [this.joi.string().hostname().required(), this.joi.string().ip().required()],
      allowcustomtld: this.joi.boolean().default(false),
      port: this.joi.number().port().required(),
      user: this.joi.string(),
      pass: this.joi.string(),
      from: this.joi
        .string()
        .required()
        .custom((value, helpers) => {
          const allowCustomTld = !!helpers.state.ancestors[0].allowcustomtld;
          const normalizedFromAddress = this.normalizeFromAddress(value, allowCustomTld);
          if (!normalizedFromAddress) {
            return helpers.error('string.email');
          }

          return normalizedFromAddress;
        }),
      to: this.joi
        .string()
        .required()
        .custom((value, helpers) => {
          const allowCustomTld = !!helpers.state.ancestors[0].allowcustomtld;
          const emailValidationResult = this.joi
            .string()
            .email({ tlds: { allow: !allowCustomTld } })
            .validate(value);

          if (emailValidationResult.error) {
            return helpers.error('string.email');
          }

          return value;
        }),
      tls: this.joi
        .object({
          enabled: this.joi.boolean().default(false),
          verify: this.joi.boolean().default(true),
        })
        .default({
          enabled: false,
          verify: true,
        }),
    });
  }

  /**
   * Sanitize sensitive data
   * @returns {*}
   */
  maskConfiguration() {
    return this.maskFields(['pass']);
  }

  /**
   * Init trigger.
   */
  initTrigger() {
    let auth;
    if (this.configuration.user || this.configuration.pass) {
      auth = {
        user: this.configuration.user,
        pass: this.configuration.pass,
      };
    }
    this.transporter = nodemailer.createTransport({
      host: this.configuration.host,
      port: this.configuration.port,
      auth,
      secure: this.configuration.tls?.enabled,
      tls: {
        rejectUnauthorized: this.configuration.tls?.verify ?? true,
      },
    });
  }

  /**
   * Send a mail with new container version details.
   *
   * @param container the container
   * @returns {Promise<void>}
   */
  async trigger(container) {
    return this.transporter.sendMail({
      from: this.configuration.from,
      to: this.configuration.to,
      subject: this.renderSimpleTitle(container),
      text: this.renderSimpleBody(container),
    });
  }

  /**
   * Send a mail with new container versions details.
   * @param containers
   * @returns {Promise<void>}
   */
  async triggerBatch(containers) {
    return this.transporter.sendMail({
      from: this.configuration.from,
      to: this.configuration.to,
      subject: this.renderBatchTitle(containers),
      text: this.renderBatchBody(containers),
    });
  }
}

export default Smtp;
