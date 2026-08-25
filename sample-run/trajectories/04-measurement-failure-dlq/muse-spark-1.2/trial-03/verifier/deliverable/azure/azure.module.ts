import { Module } from '@nestjs/common';
import { AzureService } from './azure.service.js';
import { AzureController } from './azure.controller.js';

@Module({
    controllers: [AzureController],
    providers: [AzureService],
})
export class AzureModule {}
