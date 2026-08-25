import { Injectable } from '@nestjs/common';
import { AuditScope, AuditPublishRequest } from './entities/audit.interface.js';
import { AuditEntity, ErrorAuditProcessor } from './entities/audit.entity.js';

@Injectable()
export class AuditService {
    private static auditSystem = new AuditEntity();

    public subscribeForAuditEvents() {
        AuditService.auditSystem.subscribe(AuditScope.ERROR, new ErrorAuditProcessor());
    }

    public static publishEvent(auditPublishRequest: AuditPublishRequest) {
        AuditService.auditSystem.publish(auditPublishRequest);
    }
}
