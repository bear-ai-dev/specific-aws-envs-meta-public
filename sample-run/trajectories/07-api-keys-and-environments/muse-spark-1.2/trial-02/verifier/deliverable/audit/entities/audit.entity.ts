import { randomUUID } from 'crypto';
import { Audit, AuditScope, AuditProcessor, AuditPublishRequest, AuditPublishResponse } from './audit.interface.js';
import EventEmitter from 'events';
import { Logger } from '@nestjs/common';

export class AuditEntity implements Audit {
    private eventEmitter: EventEmitter;

    constructor() {
        this.eventEmitter = new EventEmitter();
    }

    publish(publishRequest: AuditPublishRequest): AuditPublishResponse {
        this.eventEmitter.emit(publishRequest.topic, publishRequest);
        return {
            message: 'Audit published',
            id: randomUUID(),
            data: [publishRequest],
        };
    }
    subscribe(auditLevel: AuditScope, processor: AuditProcessor) {
        this.eventEmitter.on(auditLevel, processor.process);
    }
}

export class ErrorAuditProcessor implements AuditProcessor {
    private static readonly logger = new Logger(ErrorAuditProcessor.name);
    private static readonly databaseLogger = new Logger('InfluxError');
    async process(auditPublishRequest: AuditPublishRequest) {
        if (auditPublishRequest?.topic === AuditScope.DATABASE_ERROR) {
            ErrorAuditProcessor.databaseLogger.error('Database Error Occurred');
            ErrorAuditProcessor.databaseLogger.error(auditPublishRequest.message);
            ErrorAuditProcessor.databaseLogger.error(JSON.stringify(auditPublishRequest.data));
        }
        ErrorAuditProcessor.logger.error('Auditing Error Occurred');
        ErrorAuditProcessor.logger.error(auditPublishRequest.message);
        ErrorAuditProcessor.logger.error(JSON.stringify(auditPublishRequest.data));
    }
}
