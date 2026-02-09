// @ts-nocheck
import { byValues, byString } from 'sort-es';

import express from 'express';
import nocache from 'nocache';
import * as registry from '../registry';

export interface ApiComponent {
    id: string;
    type: string;
    name: string;
    configuration: any;
    agent?: string;
}

/**
 * Map a Component to a displayable (api/ui) item.
 * @param key
 * @param component
 * @returns {{id: *}}
 */
export function mapComponentToItem(key, component): ApiComponent {
    return {
        id: key,
        type: component.type,
        name: component.name,
        configuration: component.maskConfiguration(),
        agent: component.agent,
    };
}

/**
 * Return a list instead of a map.
 * @param listFunction
 * @returns {{id: string}[]}
 */
export function mapComponentsToList(components) {
    return Object.keys(components)
        .map((key) => mapComponentToItem(key, components[key]))
        .sort(
            byValues([
                [(x) => x.type, byString()],
                [(x) => x.name, byString()],
            ]),
        );
}

/**
 * Get all components.
 * @param req
 * @param res
 */
function getAll(req, res, kind) {
    res.status(200).json(mapComponentsToList(registry.getState()[kind]));
}

/**
 * Get a component by id.
 * @param req
 * @param res
 * @param listFunction
 */
export function getById(req, res, kind) {
    const { agent, type, name } = req.params;
    const id = agent ? `${agent}.${type}.${name}` : `${type}.${name}`;
    const component = registry.getState()[kind][id];
    if (component) {
        res.status(200).json(mapComponentToItem(id, component));
    } else {
        res.sendStatus(404);
    }
}

/**
 * Init the component router.
 * @param kind
 * @returns {*|Router}
 */
export function init(kind) {
    const router = express.Router();
    router.use(nocache());
    router.get('/', (req, res) => getAll(req, res, kind));
    router.get('/:type/:name', (req, res) => getById(req, res, kind));
    router.get('/:agent/:type/:name', (req, res) => getById(req, res, kind));
    return router;
}
