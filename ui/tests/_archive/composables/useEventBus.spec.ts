import { useEventBus } from '@/composables/useEventBus';

describe('useEventBus', () => {
  let eventBus;

  beforeEach(() => {
    eventBus = useEventBus();
  });

  it('should emit and listen to events', () => {
    const callback = vi.fn();

    eventBus.on('test-event', callback);
    eventBus.emit('test-event', 'data1', 'data2');

    expect(callback).toHaveBeenCalledWith('data1', 'data2');
  });

  it('should handle multiple listeners for same event', () => {
    const callback1 = vi.fn();
    const callback2 = vi.fn();

    eventBus.on('test-event', callback1);
    eventBus.on('test-event', callback2);
    eventBus.emit('test-event', 'data');

    expect(callback1).toHaveBeenCalledWith('data');
    expect(callback2).toHaveBeenCalledWith('data');
  });

  it('should remove event listeners', () => {
    const callback = vi.fn();

    eventBus.on('test-event', callback);
    eventBus.off('test-event', callback);
    eventBus.emit('test-event', 'data');

    expect(callback).not.toHaveBeenCalled();
  });

  it('should handle emit for non-existent event', () => {
    expect(() => {
      eventBus.emit('non-existent-event', 'data');
    }).not.toThrow();
  });

  it('should handle off for non-existent event', () => {
    const callback = vi.fn();
    expect(() => {
      eventBus.off('non-existent-event', callback);
    }).not.toThrow();
  });

  it('should ignore off when callback is not registered for an existing event', () => {
    const callback = vi.fn();
    const otherCallback = vi.fn();

    eventBus.on('test-event', callback);
    eventBus.off('test-event', otherCallback);
    eventBus.emit('test-event', 'payload');

    expect(callback).toHaveBeenCalledWith('payload');
    expect(otherCallback).not.toHaveBeenCalled();
  });
});
