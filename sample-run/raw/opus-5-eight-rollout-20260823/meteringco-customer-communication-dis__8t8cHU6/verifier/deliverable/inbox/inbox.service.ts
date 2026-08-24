import { Inject, Injectable, forwardRef } from '@nestjs/common';
import { CreateInboxDto, CreateResponseDto } from './dto/create-inbox.dto.js';
import { UpdateInboxDto } from './dto/update-inbox.dto.js';
import { InfluxService } from '../influx/influx.service.js';
import { Inbox, InboxLevel, IsArchived } from './entities/inbox.entity.js';
import { randomUUID } from 'crypto';
import { ReadInboxDto } from './dto/read-inbox.dto.js';

@Injectable()
export class InboxService {
    constructor(@Inject(forwardRef(() => InfluxService)) readonly influxService: InfluxService) {}
    async create(createInboxDto: CreateInboxDto): Promise<CreateResponseDto> {
        const {
            businessID,
            messageReceivedDate = new Date().toISOString(),
            title = '',
            description = '',
            level = InboxLevel.Info,
            isArchived = IsArchived.notArchived,
        } = createInboxDto;
        const inboxId = randomUUID();
        const entity = new Inbox({
            inboxId,
            businessID,
            messageReceivedDate,
            title,
            description,
            level,
            isArchived,
        });
        const points = Inbox.transformer(entity, this.influxService);
        await this.influxService.loadPoints(`${process.env.STAGE}-config`, process.env.INFLUX_ORG, points);
        return { message: 'Message created in Inbox', data: [{ inboxId }] };
    }

    async findAll({ businessID }: ReadInboxDto) {
        const messages = await Inbox.getAllInboxes({ businessID, influxService: this.influxService });
        if (messages.length) {
            return { message: 'Found messages in Inbox', data: messages.map(({ businessID, ...rest }) => rest) };
        } else {
            return { message: 'No messages found in Inbox', data: [] };
        }
    }

    async findOne({ businessID, inboxId }: ReadInboxDto) {
        const message = await Inbox.getInboxbyId({ businessID, influxService: this.influxService, inboxId });
        if (message.length) {
            return { message: 'Found message in Inbox', data: message.map(({ businessID, ...rest }) => rest) };
        } else {
            return { message: `No message for Id: ${inboxId} found in Inbox`, data: [] };
        }
    }

    async update(updateInboxDto: UpdateInboxDto) {
        const { businessID, inboxId, isArchived = IsArchived.archived } = updateInboxDto;
        const message = await this.findOne({ businessID, inboxId });
        console.log(JSON.stringify(message));
        if (message.data.length) {
            const {
                data: [element],
            } = message;
            const entity = new Inbox({ ...element, businessID, isArchived });
            const points = Inbox.transformer(entity, this.influxService);
            await this.influxService.loadPoints(`${process.env.STAGE}-config`, process.env.INFLUX_ORG, points);
            return { message: 'Message updated in Inbox', data: [{ inboxId }] };
        } else {
            return { message: `No message for Id: ${inboxId} found in Inbox`, data: [] };
        }
    }

    remove(id: number) {
        return `This action removes a #${id} inbox`;
    }
}
