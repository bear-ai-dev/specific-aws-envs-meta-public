import { Injectable } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import * as snappy from 'snappyjs';
import * as protobuf from 'protobufjs';
import chunk from 'lodash.chunk';

import { AgentMeasurementService } from '../agent-measurement/agent-measurement.service.js';
import { UsersService } from '../users/users.service.js';
import { AuditService } from '../audit/audit.service.js';
import { AuditScope } from '../audit/entities/audit.interface.js';
import { Request } from 'express';
@Injectable()
export class TransformerService {
    private static readonly logger = new Logger(TransformerService.name);
    constructor(
        private userService: UsersService,
        private agentMeasurementService: AgentMeasurementService,
    ) {}

    async recieveAgentMeasurement(request: Request) {
        try {
            const msg = [];
            request.on('data', (chunk) => {
                TransformerService.logger.log('Chunk found');
                if (chunk) {
                    msg.push(chunk);
                }
            });
            TransformerService.logger.log('message length', msg.length);
            request.on('end', async () => {
                try {
                    TransformerService.logger.log('Starting end of request');
                    const dataBlob = Buffer.concat(msg);
                    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                    //@ts-ignore
                    const { sub } = request.user;
                    TransformerService.logger.log(`Request Sub ${sub}`);
                    const res = await protobuf.load('src/transformer/remote.proto');
                    const memes = res.lookupType('WriteRequest');
                    let bufferUncompressed;
                    TransformerService.logger.log(`Data Blog size ${dataBlob.length}`);
                    const uncompressed = snappy.uncompress(dataBlob, {
                        asBuffer: true,
                    });

                    if (typeof uncompressed === 'string') {
                        bufferUncompressed = Buffer.from(uncompressed);
                    } else {
                        bufferUncompressed = uncompressed;
                    }

                    const results = memes.decode(bufferUncompressed);
                    const { timeseries, ...rest } = results.toJSON();

                    const chunkedTimeSeries = chunk(timeseries, 30);

                    const { data } = await this.userService.findOne({ subject: sub });
                    const { businessID } = data[0];

                    await Promise.all(
                        chunkedTimeSeries.map(async (timeseries) => {
                            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                            //@ts-ignore
                            await this.agentMeasurementService.create({ timeseries, businessID });
                        }),
                    );

                    TransformerService.logger.log('end of request');
                } catch (error) {
                    AuditService.publishEvent({
                        message: 'Failed to decode protobuf form meteringco agent',
                        data: [{ errorMessage: error.message, stack: error.stack }],
                        topic: AuditScope.ERROR,
                    });
                }
            });
            request.on('close', () => {
                TransformerService.logger.log('Closing request');
            });
            request.on('error', (error) => {
                TransformerService.logger.error('Error in request', error);
            });

            return { message: 'Uploaded' };
        } catch (error) {
            TransformerService.logger.error('Error in recieveAgentMeasurement', error);
            AuditService.publishEvent({
                message: 'Failed to decode protobuf form meteringco agent',
                data: [{ errorMessage: error.message, stack: error.stack }],
                topic: AuditScope.ERROR,
            });
            return { message: 'Uploaded' };
        }
    }
}
