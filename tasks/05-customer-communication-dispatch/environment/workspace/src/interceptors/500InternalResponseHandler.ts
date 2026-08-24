import {
    Injectable,
    NestInterceptor,
    ExecutionContext,
    CallHandler,
    Logger,
    InternalServerErrorException,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';

@Injectable()
export class FiveHundreadInternalErrorInterceptor implements NestInterceptor {
    private readonly logger = new Logger(FiveHundreadInternalErrorInterceptor.name);
    intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
        return next.handle().pipe(
            catchError((err) => {
                if (err instanceof InternalServerErrorException) {
                    const { user, path, method, body, query } = context.switchToHttp().getRequest();
                    this.logger.log(
                        `user: ${
                            typeof user === 'object' ? JSON.stringify(user) : user
                        }, path: ${path}, method:${method}, body: ${
                            typeof body === 'object' ? JSON.stringify(body) : body
                        }, query: ${typeof query === 'object' ? JSON.stringify(query) : query}`,
                    );
                    this.logger.error(err);
                    this.logger.error('A 500 error occurred');
                }
                throw err;
            }),
        );
    }
}
