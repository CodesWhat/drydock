const mocks = vi.hoisted(() => ({ acknowledgeApiKeyReview: vi.fn() }));

vi.mock('@/services/auth', () => ({ acknowledgeApiKeyReview: mocks.acknowledgeApiKeyReview }));

import { useApiKeyReview } from '@/composables/useApiKeyReview';

describe('useApiKeyReview', () => {
  beforeEach(() => {
    mocks.acknowledgeApiKeyReview.mockReset();
    useApiKeyReview().setApiKeyReviewPending(false);
  });

  it('starts released and mirrors what the guard sets', () => {
    const review = useApiKeyReview();
    expect(review.pending.value).toBe(false);
    review.setApiKeyReviewPending(true);
    expect(review.pending.value).toBe(true);
  });

  it('releases the review only after the server accepted the acknowledgement', async () => {
    const review = useApiKeyReview();
    review.setApiKeyReviewPending(true);
    mocks.acknowledgeApiKeyReview.mockResolvedValueOnce(undefined);

    await review.acknowledge();

    expect(mocks.acknowledgeApiKeyReview).toHaveBeenCalledTimes(1);
    expect(review.pending.value).toBe(false);
  });

  it('stays pending when the acknowledgement fails', async () => {
    const review = useApiKeyReview();
    review.setApiKeyReviewPending(true);
    mocks.acknowledgeApiKeyReview.mockRejectedValueOnce(new Error('403'));

    await expect(review.acknowledge()).rejects.toThrow('403');
    expect(review.pending.value).toBe(true);
  });
});
