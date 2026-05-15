import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Admin } from './admin.entity';

export const CurrentAdmin = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): Admin | null => {
    const request = ctx.switchToHttp().getRequest();
    return request.admin || null;
  },
);
