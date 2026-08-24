import { Injectable, NestInterceptor, ExecutionContext, CallHandler, Logger } from '@nestjs/common';
import { Observable } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';

@Injectable()
export class TimingInterceptor implements NestInterceptor {
    private readonly logger = new Logger(TimingInterceptor.name);
    intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
        this.logger.debug('Code Execution Time Start');
        const now = Date.now();
        return next.handle().pipe(
            tap(() => {
                this.logger.debug(`Code Execution Time End ${Date.now() - now}ms`);
            }),
            catchError((err) => {
                this.logger.debug(`Code Execution Time End ${Date.now() - now}ms`);
                throw err;
            }),
        );
    }
}
