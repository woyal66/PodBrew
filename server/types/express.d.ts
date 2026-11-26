import "express";
import { User as DbUser } from '@shared/schema';

declare global {
  namespace Express {
    interface User extends DbUser {}
    interface Request {
      userId?: string;
      guestId?: string;
    }
  }
}
