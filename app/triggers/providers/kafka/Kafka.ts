import { Kafka as KafkaClient, type KafkaConfig, type Producer, type SASLOptions } from 'kafkajs';
import Trigger from '../Trigger.js';

type UserPasswordSaslMechanism = 'plain' | 'scram-sha-256' | 'scram-sha-512';
type UserPasswordSaslOptions = Extract<SASLOptions, { username: string; password: string }>;

const AUTH_TYPE_TO_SASL_MECHANISM = {
  PLAIN: 'plain',
  'SCRAM-SHA-256': 'scram-sha-256',
  'SCRAM-SHA-512': 'scram-sha-512',
} as const;

function toSaslMechanism(authType: string): UserPasswordSaslMechanism {
  return (
    AUTH_TYPE_TO_SASL_MECHANISM[authType as keyof typeof AUTH_TYPE_TO_SASL_MECHANISM] ?? 'plain'
  );
}

/**
 * Kafka Trigger implementation
 */
class Kafka extends Trigger {
  private kafka!: KafkaClient;
  private producer?: Producer;

  /**
   * Get the Trigger configuration schema.
   * @returns {*}
   */
  getConfigurationSchema() {
    return this.joi.object().keys({
      brokers: this.joi.string().required(),
      topic: this.joi.string().default('drydock-container'),
      clientid: this.joi.string().default('drydock'),
      ssl: this.joi.boolean().default(false),
      authentication: this.joi.object({
        type: this.joi
          .string()
          .allow('PLAIN')
          .allow('SCRAM-SHA-256')
          .allow('SCRAM-SHA-512')
          .default('PLAIN'),
        user: this.joi.string().required(),
        password: this.joi.string().required(),
      }),
    });
  }

  /**
   * Sanitize sensitive data
   * @returns {*}
   */
  maskConfiguration() {
    return {
      ...this.configuration,
      brokers: this.configuration.brokers,
      topic: this.configuration.topic,
      clientid: this.configuration.clientid,
      ssl: this.configuration.ssl,
      authentication: this.configuration.authentication
        ? {
            type: this.configuration.authentication.type,
            user: this.configuration.authentication.user,
            password: Kafka.mask(this.configuration.authentication.password),
          }
        : undefined,
    };
  }

  /**
   * Init trigger.
   */
  async initTrigger() {
    const brokers = this.configuration.brokers.split(',').map((broker) => broker.trim());
    const clientConfiguration: KafkaConfig = {
      clientId: this.configuration.clientid,
      brokers,
      ssl: this.configuration.ssl,
    };
    if (this.configuration.authentication) {
      const sasl: UserPasswordSaslOptions = {
        mechanism: toSaslMechanism(this.configuration.authentication.type),
        username: this.configuration.authentication.user,
        password: this.configuration.authentication.password,
      };
      clientConfiguration.sasl = sasl;
    }
    this.kafka = new KafkaClient(clientConfiguration);
    this.producer = this.kafka.producer();
    await this.producer.connect();
  }

  async deregisterComponent(): Promise<void> {
    await super.deregisterComponent();
    if (!this.producer) {
      return;
    }
    await this.producer.disconnect();
    this.producer = undefined;
  }

  private getProducer(): Producer {
    if (!this.producer) {
      throw new Error('Kafka producer is not initialized');
    }
    return this.producer;
  }

  /**
   * Send a record to a Kafka topic with new container version details.
   *
   * @param container the container
   * @returns {Promise<void>}
   */
  async trigger(container) {
    return await this.getProducer().send({
      topic: this.configuration.topic,
      messages: [{ value: JSON.stringify(container) }],
    });
  }

  /**
   * Send a record to a Kafka topic with new container versions details.
   * @param containers
   * @returns {Promise<RecordMetadata[]>}
   */
  async triggerBatch(containers) {
    return await this.getProducer().send({
      topic: this.configuration.topic,
      messages: containers.map((container) => ({
        value: JSON.stringify(container),
      })),
    });
  }
}

export default Kafka;
