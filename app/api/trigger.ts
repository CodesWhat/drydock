// @ts-nocheck
import * as component from './component';
import * as registry from '../registry';
import * as agent from '../agent';
import logger from '../log';

const log = logger.child({ component: 'trigger' });

/**
 * Run a specific trigger on a specific container provided in the payload.
 */
export async function runTrigger(req, res) {
    const triggerType = req.params.type;
    const triggerName = req.params.name;
    const containerToTrigger = req.body;

    if (!containerToTrigger) {
        log.warn(
            `Trigger cannot be executed without container (type=${triggerType}, name=${triggerName})`,
        );
        res.status(400).json({
            error: `Error when running trigger ${triggerType}.${triggerName} (container is undefined)`,
        });
        return;
    }

    // Running local triggers on remote containers is not supported
    if (containerToTrigger.agent) {
        log.warn(
            `Cannot execute local trigger ${triggerType}.${triggerName} on remote container ${containerToTrigger.agent}.${containerToTrigger.id}`,
        );
        res.status(400).json({
            error: `Cannot execute local trigger ${triggerType}.${triggerName} on remote container ${containerToTrigger.agent}.${containerToTrigger.id}`,
        });
        return;
    }

    const triggerToRun =
        registry.getState().trigger[`${triggerType}.${triggerName}`];
    if (!triggerToRun) {
        log.warn(`No trigger found(type=${triggerType}, name=${triggerName})`);
        res.status(404).json({
            error: `Error when running trigger ${triggerType}.${triggerName} (trigger not found)`,
        });
        return;
    }

    try {
        log.debug(
            `Running trigger ${triggerType}.${triggerName} (container=${JSON.stringify(
                containerToTrigger,
            )})`,
        );
        await triggerToRun.trigger(containerToTrigger);
        log.info(
            `Trigger executed with success (type=${triggerType}, name=${triggerName}, container=${JSON.stringify(containerToTrigger)})`,
        );
        res.status(200).json({});
    } catch (e) {
        log.warn(
            `Error when running trigger ${triggerType}.${triggerName} (${e.message})`,
        );
        res.status(500).json({
            error: `Error when running trigger ${triggerType}.${triggerName} (${e.message})`,
        });
    }
}

/**
 * Run a specifically targeted remote trigger.
 */
async function runRemoteTrigger(req, res) {
    const {
        agent: agentName,
        type: triggerType,
        name: triggerName,
    } = req.params;
    const containerToTrigger = req.body;

    const agentClient = agent.getAgent(agentName);
    if (!agentClient) {
        res.status(404).json({ error: `Agent ${agentName} not found` });
        return;
    }

    if (!containerToTrigger || !containerToTrigger.id) {
        res.status(400).json({
            error: 'Container with ID is required in body',
        });
        return;
    }

    try {
        await agentClient.runRemoteTrigger(
            containerToTrigger,
            triggerType,
            triggerName,
        );
        log.info(
            `Remote trigger executed with success (agent=${agentName}, type=${triggerType}, name=${triggerName}, container=${containerToTrigger.id})`,
        );
        res.status(200).json({});
    } catch (e) {
        log.warn(
            `Error when running remote trigger ${triggerType}.${triggerName} on agent ${agentName} (${e.message})`,
        );
        res.status(500).json({
            error: `Error when running remote trigger ${triggerType}.${triggerName} on agent ${agentName} (${e.message})`,
        });
    }
}

/**
 * Init Router.
 * @returns {*}
 */
export function init() {
    const router = component.init('trigger');
    router.post('/:type/:name', runTrigger);
    router.post('/:agent/:type/:name', runRemoteTrigger);
    return router;
}
