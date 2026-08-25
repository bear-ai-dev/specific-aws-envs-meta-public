import { Inject, Injectable, Logger, NotFoundException, forwardRef } from '@nestjs/common';
import { AlertState, CreateAlertDto } from './dto/create-alert.dto.js';
import { InfluxService } from '../influx/influx.service.js';
import { AlertEntity } from './entities/alert.entity.js';
import { WebhookProcessorEventType, WebhookPublishingService } from '../webhook/webhook.service.js';

@Injectable()
export class AlertsService {
    private static logger = new Logger(AlertsService.name);
    constructor(@Inject(forwardRef(() => InfluxService)) readonly influxService: InfluxService) {}
    async create(createAlertDto: CreateAlertDto) {
        AlertsService.logger.debug(`Creating alert for  ${createAlertDto.businessID} and ${createAlertDto.alertId}`);
        const currentAlertRow = await this.influxService.getCurrentAlertState({
            businessID: createAlertDto.businessID,
            alertId: createAlertDto.alertId,
        });
        if (currentAlertRow?.length) {
            AlertsService.logger.debug(`Alert already exists for ${createAlertDto.alertId}`);
            const currentAlert = AlertEntity.fromDbModel(currentAlertRow[0]);
            if (currentAlert.alertState === createAlertDto.alertState) {
                // Just commit the row to DB
                const alertEntity = new AlertEntity(createAlertDto);
                const points = AlertEntity.transformer(alertEntity, this.influxService);
                await this.influxService.loadPoints(`${process.env.STAGE}-config`, `${process.env.INFLUX_ORG}`, points);
            } else {
                AlertsService.logger.debug(`Alert state changed for ${createAlertDto.alertId}`);
                // Create a new row
                const alertEntity = new AlertEntity(createAlertDto);
                const points = AlertEntity.transformer(alertEntity, this.influxService);
                await this.influxService.loadPoints(`${process.env.STAGE}-config`, `${process.env.INFLUX_ORG}`, points);
                // Send Webhook if the alarm is not OK and the current alert is not ALARM. This is to avoid sending multiple webhooks for the same alert.
                if (createAlertDto.alertState !== AlertState.OK && currentAlert?.alertState !== AlertState.ALARM) {
                    AlertsService.logger.debug(`Sending webhook for ${createAlertDto.alertId}`);
                    WebhookPublishingService.publishEvent({
                        topic: WebhookProcessorEventType.Standard,
                        type: createAlertDto?.webhookParameters?.webhookType,
                        data: [createAlertDto?.webhookParameters],
                        businessID: createAlertDto.businessID,
                    });
                }
            }
        } else {
            AlertsService.logger.debug(`Creating new alert for ${createAlertDto.alertId}`);
            const alertEntity = new AlertEntity(createAlertDto);
            const points = AlertEntity.transformer(alertEntity, this.influxService);
            await this.influxService.loadPoints(`${process.env.STAGE}-config`, `${process.env.INFLUX_ORG}`, points);
            // Send Webhook if the alarm is not OK.
            if (createAlertDto.alertState !== AlertState.OK) {
                AlertsService.logger.debug(`Sending webhook for ${createAlertDto.alertId}`);
                WebhookPublishingService.publishEvent({
                    topic: WebhookProcessorEventType.Standard,
                    type: createAlertDto?.webhookParameters?.webhookType,
                    data: [createAlertDto?.webhookParameters],
                    businessID: createAlertDto.businessID,
                });
            }
        }
    }

    async findOne({ alertId, businessID }: { alertId: string; businessID: string }) {
        const currentAlertRow = await this.influxService.getCurrentAlertState({
            businessID,
            alertId,
        });
        if (currentAlertRow?.length) {
            const currentAlert = AlertEntity.fromDbModel(currentAlertRow[0]);
            return currentAlert;
        } else {
            throw new NotFoundException(`Alert with id ${alertId} not found`);
        }
    }
}
