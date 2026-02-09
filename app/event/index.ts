// @ts-nocheck
import events from 'events';

// Build EventEmitter
const eventEmitter = new events.EventEmitter();

// Container related events
const WUD_CONTAINER_ADDED = 'wud:container-added';
const WUD_CONTAINER_UPDATED = 'wud:container-updated';
const WUD_CONTAINER_REMOVED = 'wud:container-removed';

// Watcher related events
const WUD_WATCHER_START = 'wud:watcher-start';
const WUD_WATCHER_STOP = 'wud:watcher-stop';

const DEFAULT_HANDLER_ORDER = 100;

interface EventHandlerRegistrationOptions {
    order?: number;
    id?: string;
}

interface OrderedEventHandler {
    handler: (payload: any) => any;
    order: number;
    id: string;
    sequence: number;
}

const containerReportHandlers: OrderedEventHandler[] = [];
const containerReportsHandlers: OrderedEventHandler[] = [];
let handlerRegistrationSequence = 0;

function registerOrderedEventHandler(
    handlers: OrderedEventHandler[],
    handler: (payload: any) => any,
    options: EventHandlerRegistrationOptions = {},
) {
    const orderNumber = Number(options.order);
    handlers.push({
        handler,
        order: Number.isFinite(orderNumber)
            ? orderNumber
            : DEFAULT_HANDLER_ORDER,
        id: options.id || '',
        sequence: handlerRegistrationSequence++,
    });
    return () => {
        const handlerIndex = handlers.findIndex(
            (registeredHandler) => registeredHandler.handler === handler,
        );
        if (handlerIndex >= 0) {
            handlers.splice(handlerIndex, 1);
        }
    };
}

function compareOrderedHandlers(
    handlerA: OrderedEventHandler,
    handlerB: OrderedEventHandler,
) {
    if (handlerA.order !== handlerB.order) {
        return handlerA.order - handlerB.order;
    }
    if (handlerA.id !== handlerB.id) {
        return handlerA.id.localeCompare(handlerB.id);
    }
    return handlerA.sequence - handlerB.sequence;
}

async function emitOrderedHandlers(
    handlers: OrderedEventHandler[],
    payload: any,
) {
    const handlersOrdered = [...handlers].sort(compareOrderedHandlers);
    for (const handler of handlersOrdered) {
        await handler.handler(payload);
    }
}

/**
 * Emit ContainerReports event.
 * @param containerReports
 */
export async function emitContainerReports(containerReports) {
    await emitOrderedHandlers(containerReportsHandlers, containerReports);
}

/**
 * Register to ContainersResult event.
 * @param handler
 */
export function registerContainerReports(
    handler,
    options: EventHandlerRegistrationOptions = {},
) {
    return registerOrderedEventHandler(
        containerReportsHandlers,
        handler,
        options,
    );
}

/**
 * Emit ContainerReport event.
 * @param containerReport
 */
export async function emitContainerReport(containerReport) {
    await emitOrderedHandlers(containerReportHandlers, containerReport);
}

/**
 * Register to ContainerReport event.
 * @param handler
 */
export function registerContainerReport(
    handler,
    options: EventHandlerRegistrationOptions = {},
) {
    return registerOrderedEventHandler(containerReportHandlers, handler, options);
}

/**
 * Emit container added.
 * @param containerAdded
 */
export function emitContainerAdded(containerAdded) {
    eventEmitter.emit(WUD_CONTAINER_ADDED, containerAdded);
}

/**
 * Register to container added event.
 * @param handler
 */
export function registerContainerAdded(handler) {
    eventEmitter.on(WUD_CONTAINER_ADDED, handler);
}

/**
 * Emit container added.
 * @param containerUpdated
 */
export function emitContainerUpdated(containerUpdated) {
    eventEmitter.emit(WUD_CONTAINER_UPDATED, containerUpdated);
}

/**
 * Register to container updated event.
 * @param handler
 */
export function registerContainerUpdated(handler) {
    eventEmitter.on(WUD_CONTAINER_UPDATED, handler);
}

/**
 * Emit container removed.
 * @param containerRemoved
 */
export function emitContainerRemoved(containerRemoved) {
    eventEmitter.emit(WUD_CONTAINER_REMOVED, containerRemoved);
}

/**
 * Register to container removed event.
 * @param handler
 */
export function registerContainerRemoved(handler) {
    eventEmitter.on(WUD_CONTAINER_REMOVED, handler);
}

export function emitWatcherStart(watcher) {
    eventEmitter.emit(WUD_WATCHER_START, watcher);
}

export function registerWatcherStart(handler) {
    eventEmitter.on(WUD_WATCHER_START, handler);
}

export function emitWatcherStop(watcher) {
    eventEmitter.emit(WUD_WATCHER_STOP, watcher);
}

export function registerWatcherStop(handler) {
    eventEmitter.on(WUD_WATCHER_STOP, handler);
}

// Testing helper.
export function clearAllListenersForTests() {
    eventEmitter.removeAllListeners();
    containerReportHandlers.length = 0;
    containerReportsHandlers.length = 0;
    handlerRegistrationSequence = 0;
}
