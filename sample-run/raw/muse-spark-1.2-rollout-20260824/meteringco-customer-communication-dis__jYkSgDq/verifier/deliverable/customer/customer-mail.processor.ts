import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { CustomerService } from './customer.service.js';
import { CustomerCommunicationChannel } from './entities/customerCommunication.interface.js';

@Injectable()
export class CustomerCommunicationMailService implements OnModuleInit {
    private readonly logger = new Logger(CustomerCommunicationMailService.name);
    onModuleInit() {
        try {
            CustomerService.customerCommunicationSystem.subscribe(
                CustomerCommunicationChannel.EMAIL,
                {
                    process: () => {
                        // SES delivery is handled directly in CustomerCommunicationEntity.publish
                        // This subscription keeps Nest wiring valid and avoids double-send
                    },
                } as any,
            );
            this.logger.log('CustomerCommunicationMailService initialized (SES handled in entity)');
        } catch (_e) {}
    }
}
