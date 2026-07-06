import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable, tap, catchError, throwError } from 'rxjs';
import { AuditService } from './audit.service';

/**
 * Ghi nhật ký MỌI request ghi/sửa/xoá CÓ đăng nhập (req.user do guard gắn).
 * - GET/HEAD/OPTIONS → bỏ qua (chỉ đọc).
 * - Request chưa đăng nhập (login/register/webhook git) → bỏ qua.
 * - KHÔNG đọc body — env value/mật khẩu không bao giờ lọt vào log.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly audit: AuditService) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (ctx.getType() !== 'http') return next.handle();
    const req = ctx.switchToHttp().getRequest<Request & { user?: { sub?: string; email?: string } }>();
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next.handle();
    const user = req.user;
    if (!user?.sub) return next.handle();

    const path = (req.originalUrl ?? req.url ?? '').split('?')[0];
    const ip =
      (typeof req.headers['x-forwarded-for'] === 'string'
        ? req.headers['x-forwarded-for'].split(',')[0].trim()
        : undefined) ?? req.ip;

    return next.handle().pipe(
      tap(() => {
        const res = ctx.switchToHttp().getResponse<Response>();
        this.audit.record({
          userId: user.sub,
          userEmail: user.email,
          method: req.method,
          path,
          status: res.statusCode,
          ip,
        });
      }),
      catchError((err: unknown) => {
        const status =
          typeof (err as { getStatus?: () => number }).getStatus === 'function'
            ? (err as { getStatus: () => number }).getStatus()
            : 500;
        this.audit.record({
          userId: user.sub,
          userEmail: user.email,
          method: req.method,
          path,
          status,
          ip,
        });
        return throwError(() => err);
      }),
    );
  }
}
