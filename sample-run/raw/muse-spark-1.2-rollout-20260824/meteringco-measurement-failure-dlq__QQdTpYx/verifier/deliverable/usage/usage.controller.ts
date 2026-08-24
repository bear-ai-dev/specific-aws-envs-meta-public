import { BadRequestException, Body, Controller, Logger, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { serializeError } from 'serialize-error';
import {
    ApiBadRequestResponse,
    ApiBearerAuth,
    ApiCreatedResponse,
    ApiOperation,
    ApiQuery,
    ApiTags,
} from '@nestjs/swagger';
import { BasicResponseDTO } from '../basicResponseDTO.js';
import { CreateUsageDto } from './dto/create-usage.dto.js';
import { UsageService } from './usage.service.js';
import { Request } from 'express';
import { LogGaurd } from '../authz/logGaurd.js';
import { DlqType, StandardMeasurementEntity } from '../measurement-config/entities/standardMeasurement.entity.js';
import { randomUUID } from 'crypto';
import { AuditService } from '../audit/audit.service.js';
import { AuditScope } from '../audit/entities/audit.interface.js';
import { Validator } from 'class-validator';
import { CreateStandardMeasurementDto } from '../measurement-config/dto/create-standard-measurement.dto.js';
import { PermissionsGuard } from '../authz/PermissionsGaurd.js';
import { UsagePermissions } from './usage.permissions.js';
import { InvoicesService } from '../invoice/invoices.service.js';
import { AuthorizedRequest } from '../authz/jwt-local.gaurd.js';
import { CustomerService } from '../customer/customer.service.js';
import { InfluxAggregateUsageEvent } from '../influx/influxUsageAggregateEvent.js';
import { PaymentSchedule, aggregationMethod } from '../dimensions/dto/create-dimension.dto.js';
import { UsageResponseDocument } from '../customer/dto/read-customer.dto.js';
import { ReadOfferingResponseData } from '../offering/dto/readOffering.dto.js';

@ApiBearerAuth('bearer')
@ApiTags('Usage')
@Controller('usage')
export class UsageController {
    readonly validator = new Validator();
    public static readonly logger = new Logger(UsageController.name);
    constructor(
        public readonly usageService: UsageService,
        public readonly invoiceService: InvoicesService,
        public readonly customerService: CustomerService,
    ) {}

    /**
     * Collect usage data by API-based method.
     * See <a href="https://docs.meteringco.example/measure-usage-and-collect-data/measure-and-collect-usage-data-at-production-scale">Measure and Collect Usage Data At Production Scale</a>
     * for full documentation on MeteringCo <b>Usage Measurement and Collection</b>.
     * @param createUsageDto
     * @param request
     */
    @ApiCreatedResponse({
        status: 201,
        description: 'OK',
        type: BasicResponseDTO,
    })
    @ApiBadRequestResponse({
        status: 400,
        description: 'Bad Request',
        type: BasicResponseDTO,
    })
    @ApiQuery({
        description:
            'The invoice query parameter is used to create an invoice for the usage data body. It can _only_ be used with dimensions that have an `upfront` payment schedule and `last` aggregation method. If the dimension does not have these properties, the invoice will not be created and a `400` status code will be returned. Additionally, the customer for the usage must be actively enrolled in an offering in order to make use of the automated invoice, otherwise a `400` error will be returned. The body will not be loaded into the database on any `400` error. <br/><br/> The invoice created is independent of any `tiers`, or `entitlement` associated with the dimension, and will be created for the exact usage data sent in. <br/><br/> The invoice will be created for the difference between the usage data sent in, and the most recent usage data for the dimension. If the usage data sent in is less than the most recent usage data, a zero quantity line item will be created. For example if the most recent usage data for a dimension is `5`, and the usage data sent in is `3`, a zero quantity line item will be created. If the usage data sent in is `7`, a `2` quantity line item will be created.',
        name: 'invoice',
        type: Boolean,
        example: true,
        required: false,
    })
    @ApiOperation({ operationId: 'Collect usage data' })
    @UseGuards(AuthGuard('jwt'))
    @Post()
    async create(
        @Body() createUsageDto: CreateUsageDto,
        @Req() request: AuthorizedRequest,
        @Query('invoice') invoice: boolean,
    ) {
        const { businessID } = request.user;
        if (invoice) {
            const customerReadResponse = await this.customerService.findOne({
                customerId: createUsageDto.customerId,
                businessID,
            });
            const {
                data: [{ enrollments }],
            } = customerReadResponse;
            if (!enrollments?.length) {
                throw new BadRequestException('No offering/enrollment found for customer cannot create invoice');
            }
            const dimensions = enrollments.reduce((acc, enrollment) => {
                if (enrollment && enrollment?.offering?.dimensions) {
                    const dimensionIdMatch = enrollment?.offering?.dimensions.find(
                        ({ dimensionId }) => dimensionId === createUsageDto.dimensionId,
                    );
                    if (dimensionIdMatch) {
                        acc.push(dimensionIdMatch);
                    }
                }
                return acc;
            }, []);
            if (!dimensions || !dimensions?.length) {
                throw new BadRequestException('No dimension found for customer offering cannot create invoice');
            }
            if (dimensions[0]?.paymentSchedule !== PaymentSchedule.upfront) {
                throw new BadRequestException(
                    `Payment schedule for dimension: ${dimensions[0]?.dimensionId} is not upfront, will not create invoice`,
                );
            }
            if (dimensions[0]?.aggregationMethod !== aggregationMethod.last) {
                throw new BadRequestException(
                    `Aggregation method for dimension: ${dimensions[0]?.dimensionId} is not last, will not create invoice`,
                );
            }
            const customer = { ...customerReadResponse?.data[0], businessID };
            const usage = await this.usageService.findUsageForCustomer(
                { businessID, customerId: createUsageDto?.customerId, customer },
                {},
            );
            const dimensionUsage = usage.find((usage) => usage.dimensionId === createUsageDto.dimensionId);
            const { usage: recentDimensionUsageForInvoice } = dimensionUsage;
            const { value } = recentDimensionUsageForInvoice[
                recentDimensionUsageForInvoice.length - 1
            ] as UsageResponseDocument;

            await this.usageService.create({ ...createUsageDto, businessID });
            let invoiceUsageValueInput: number;

            if (parseFloat(value) < parseFloat(createUsageDto?.recordValue)) {
                invoiceUsageValueInput = parseFloat(createUsageDto?.recordValue) - parseFloat(value);
            } else {
                invoiceUsageValueInput = 0;
            }

            return this.invoiceService.generateInvoiceGivenUsage(
                customer,
                InfluxAggregateUsageEvent.convertCreateUsageDtoToAggregateUsageResponse([
                    { ...createUsageDto, recordValue: invoiceUsageValueInput.toFixed(2) },
                ]),
            );
        } else {
            return this.usageService.create({ ...createUsageDto, businessID }, request?.user?.sub);
        }
    }
}

@ApiBearerAuth('bearer')
@ApiTags('Usage')
@Controller('usage')
export class PrivateAPIUsageController extends UsageController {
    @UseGuards(LogGaurd, AuthGuard('jwt'))
    @Post('db')
    async dbUsage(@Body() createUsageDto) {
        // Custom validator for DB usage, on failure push to DLQ for manual processing
        try {
            UsageController.logger.log('Starting DB Usage Endpoint execution');

            const { message, s3Key } = createUsageDto;
            // TODO: check if the passed in BusinessID is an authorized producer, if not throw message away
            if (s3Key) {
                const [businessID] = s3Key.split('/');

                const parsed = JSON.parse(message);
                const doc = new CreateStandardMeasurementDto({ ...parsed, businessID });
                await this.validator.validateOrReject(doc, { enableDebugMessages: true });
                const input = { ...parsed, businessID };
                return this.usageService.create(input);
            } else {
                AuditService.publishEvent({
                    topic: AuditScope.ERROR,
                    message: 'Unknown S3 Key and BusinessID In datastore measurement system',
                    data: [{ e: 'Unknown S3 Key and BusinessID In datastore measurement system', createUsageDto }],
                });
                throw new BadRequestException(
                    'Invalid message format, please check the documentation for the correct format',
                );
            }
        } catch (e) {
            UsageController.logger.error('Error parsing datastore usage message', e);
            // Preserve rejected datastore messages in the dead-letter bucket under their source file
            // so the owning business can find them. Keep original input and failure info,
            // never overwrite an earlier rejection, retain messages with no source file,
            // and still reject the caller even if DLQ storage fails.
            try {
                const dlqBucket = process.env.DB_MEASUREMENT_DLQ_BUCKET_NAME;
                if (dlqBucket) {
                    const { S3Client, PutObjectCommand, HeadObjectCommand } = await import('@aws-sdk/client-s3');
                    const s3 = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });
                    const s3Key = (createUsageDto as any)?.s3Key;
                    const message = (createUsageDto as any)?.message;
                    let dlqKey: string;
                    let orginalProcessedName: string;
                    if (s3Key) {
                        dlqKey = s3Key;
                        orginalProcessedName = s3Key;
                    } else {
                        const fallbackId = randomUUID();
                        dlqKey = `meteringco-unknown/${fallbackId}.json`;
                        orginalProcessedName = `meteringco-unknown/${fallbackId}`;
                    }
                    const payload = JSON.stringify({
                        failedDocument: {
                            originalFileContent: message,
                            ...(s3Key ? { s3Key } : {}),
                        },
                        metadata: {
                            timestamp: new Date().toISOString(),
                            errorInfo: serializeError(e),
                            results: 'failed to load data',
                            orginalProcessedName,
                        },
                    });
                    let shouldPut = true;
                    try {
                        await s3.send(new HeadObjectCommand({ Bucket: dlqBucket, Key: dlqKey }));
                        // Object already exists - never overwrite
                        shouldPut = false;
                    } catch (headErr: any) {
                        const headCode = headErr?.Code || headErr?.name || headErr?.code;
                        const headStatus = headErr?.$metadata?.httpStatusCode;
                        if (
                            headStatus === 404 ||
                            headCode === 'NotFound' ||
                            headCode === 'NoSuchKey' ||
                            headCode === 'NoSuchBucket'
                        ) {
                            // NoSuchBucket means DLQ bucket missing - still should not overwrite logic, but Put will fail and be caught
                            if (
                                headCode === 'NoSuchBucket' ||
                                (headStatus === 404 && headErr?.message?.includes('NoSuchBucket'))
                            ) {
                                // Bucket missing - Put will fail, let it try and be handled
                                shouldPut = true;
                            } else {
                                // Key not found - safe to put
                                shouldPut = dlqKey ? true : false;
                                // For NoSuchBucket, we still try Put to generate proper error handling, but caller still gets rejection
                                if (headCode === 'NoSuchBucket') shouldPut = true;
                            }
                        } else {
                            // Unknown head error - log but still attempt put? safer to skip to avoid overwrite loop
                            UsageController.logger.error('DLQ head check failed', headErr);
                            shouldPut = true;
                        }
                    }
                    if (shouldPut) {
                        try {
                            await s3.send(
                                new PutObjectCommand({
                                    Bucket: dlqBucket,
                                    Key: dlqKey,
                                    Body: payload,
                                    ContentType: 'application/json',
                                    IfNoneMatch: '*',
                                } as any),
                            );
                        } catch (putErr: any) {
                            const code = putErr?.Code || putErr?.name || putErr?.code;
                            const status = putErr?.$metadata?.httpStatusCode;
                            // PreconditionFailed / 412 means an earlier rejection already exists - do not overwrite
                            if (code !== 'PreconditionFailed' && status !== 412) {
                                // Also treat NoSuchBucket / NoSuchKey as expected DLQ write failures - just log debug
                                UsageController.logger.error('Failed to write to DLQ bucket', putErr);
                            }
                        }
                    }
                }
            } catch (dlqErr) {
                UsageController.logger.error('DLQ preservation failed', dlqErr as any);
            }
            throw new BadRequestException(
                'Invalid message format, please check the documentation for the correct format',
            );
        }
    }
    @UseGuards(PermissionsGuard([UsagePermissions.ADMIN_CREATE_USAGE]))
    @UseGuards(AuthGuard('jwt'))
    @Post('datastore')
    async datastoreUsage(@Body() createUsageDto, @Req() request: Request) {
        // Custom validator for DB usage, on failure push to DLQ for manual processing

        try {
            const { businessid } = request.headers;
            //TODO: make this a standardized parser which is driven by an event-type

            UsageController.logger.log('Starting DB Usage Endpoint execution');

            const { event } = createUsageDto;
            const parsed = JSON.parse(event?.original);
            const doc = new CreateStandardMeasurementDto({ ...parsed, businessID: businessid });
            await this.validator.validateOrReject(doc, { enableDebugMessages: true });
            return this.usageService.create(doc as CreateUsageDto);
        } catch (e) {
            UsageController.logger.error('Error parsing datastore usage message', e);
            e.stack = undefined;
            await StandardMeasurementEntity.publishFailureToDLQ(
                { originalFileContent: createUsageDto?.event },
                {
                    timestamp: new Date().toISOString(),
                    errorInfo: serializeError(e),
                    results: 'failed to load data',

                    orginalProcessedName: `${
                        request?.headers?.businessid ? request?.headers?.businessid : 'unknown'
                    } - ${request?.headers?.uniqueid ? request?.headers?.uniqueid : `rand-${randomUUID()}`}}`,
                    businessID: request?.headers?.businessid as string,
                    measurementId: request?.headers?.uniqueid as string,
                },
                DlqType.kafka,
            );
            throw new BadRequestException(
                'Invalid message format, please check the documentation for the correct format, and check DLQ for message',
            );
        }
    }
}
