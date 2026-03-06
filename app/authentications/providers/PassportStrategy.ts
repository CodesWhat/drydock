interface PassportStrategy {
  success: (user: unknown) => void;
  fail: (status: number) => void;
}

const asPassportStrategy = (strategy: unknown): PassportStrategy => strategy as PassportStrategy;

export { asPassportStrategy };
