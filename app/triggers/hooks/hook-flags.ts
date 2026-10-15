export function isHooksExecutionEnabled(): boolean {
  return process.env.DD_HOOKS_ENABLED?.trim().toLowerCase() === 'true';
}

export function isImageHookLabelsAllowed(): boolean {
  return process.env.DD_HOOKS_ALLOW_IMAGE_LABELS?.trim().toLowerCase() === 'true';
}
