import { createMockResponse } from '../test/helpers.js';
import { requireDestructiveActionConfirmation } from './destructive-confirmation.js';

describe('requireDestructiveActionConfirmation', () => {
  test('calls next when the confirmation header matches', () => {
    const middleware = requireDestructiveActionConfirmation('Delete-Container');
    const req = {
      headers: {
        'x-dd-confirm-action': '  delete-container  ',
      },
    } as any;
    const res = createMockResponse();
    const next = vi.fn();

    middleware(req, res as any, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  test('uses the first header entry when multiple values are provided', () => {
    const middleware = requireDestructiveActionConfirmation('delete-container');
    const req = {
      headers: {
        'x-dd-confirm-action': ['wrong-value', 'delete-container'],
      },
    } as any;
    const res = createMockResponse();
    const next = vi.fn();

    middleware(req, res as any, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(428);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Confirmation required: X-DD-Confirm-Action=delete-container',
    });
  });

  test('rejects blank or missing confirmation header values', () => {
    const middleware = requireDestructiveActionConfirmation('delete-container');
    const blankRes = createMockResponse();
    const missingRes = createMockResponse();
    const next = vi.fn();

    middleware(
      {
        headers: {
          'x-dd-confirm-action': '   ',
        },
      } as any,
      blankRes as any,
      next,
    );
    middleware({ headers: {} } as any, missingRes as any, next);

    expect(next).not.toHaveBeenCalled();
    expect(blankRes.status).toHaveBeenCalledWith(428);
    expect(blankRes.json).toHaveBeenCalledWith({
      error: 'Confirmation required: X-DD-Confirm-Action=delete-container',
    });
    expect(missingRes.status).toHaveBeenCalledWith(428);
    expect(missingRes.json).toHaveBeenCalledWith({
      error: 'Confirmation required: X-DD-Confirm-Action=delete-container',
    });
  });
});
