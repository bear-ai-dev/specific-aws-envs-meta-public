import { Injectable, CanActivate, ExecutionContext, Logger } from '@nestjs/common';
import { Observable } from 'rxjs';

@Injectable()
export class LogGaurd implements CanActivate {
    private static readonly logger = new Logger(LogGaurd.name);
    canActivate(context: ExecutionContext): boolean | Promise<boolean> | Observable<boolean> {
        try {
            const request = context.switchToHttp().getRequest();
            LogGaurd.logger.log(request?.headers);
            LogGaurd.logger.log(request?.body);
        } catch (e) {
            LogGaurd.logger.error(e);
        }
        return true;
    }
}
