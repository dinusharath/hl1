import type { NextFunction, Request, Response } from "express";

/**
 * Wrap an async Express handler so a rejected promise is forwarded to the error middleware
 * instead of becoming an unhandled rejection (which hangs the request in Express 4).
 */
export function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res, next).catch(next);
  };
}
