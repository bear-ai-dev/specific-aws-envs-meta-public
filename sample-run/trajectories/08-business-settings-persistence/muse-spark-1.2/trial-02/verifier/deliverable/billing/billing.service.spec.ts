import { Test, TestingModule } from '@nestjs/testing';
import { BillingService } from './billing.service.js';
import { createMock } from '@golevelup/ts-jest';
import { Billing } from './entities/billing.entity.js';
import { ValidBillingCycles } from '../offering/dto/createOffering.dto.js';
import { InfluxService } from '../influx/influx.service.js';
import { MockInfluxService } from '../../test/fixtures/module/mockInfluxService.js';
import { BullModule, getQueueOptionsToken, getQueueToken } from '@nestjs/bull';
import { Queue, QueueOptions } from 'bull';
import { randomUUID } from 'crypto';
import { customerDBModelGenerator } from '../../test/fixtures/data/customer.js';
import { offeringDBModelGenerator } from '../../test/fixtures/data/offering.js';
import { dimensionDBModelGenerator } from '../../test/fixtures/data/dimension.js';
import { aggregateUsageGenerator } from '../../test/fixtures/data/usage.js';
import { CustomerInfluxRow } from '../influx/entities/customerInfluxRow.js';
import { forwardRef } from '@nestjs/common';
import { InfluxModule } from '../influx/influx.module.js';
import { PrivateAPICustomerModule } from '../customer/customer.module.js';
import { PrivateAPIInvoicesModule } from '../invoice/invoices.module.js';
import { SchedulerModule } from '../scheduler/scheduler.module.js';
import { ContractModule } from '../contract/contract.module.js';
import { PrivateAPISettingsModule } from '../setting/settings.module.js';
import { TokenConsumerService } from '../token-consumer/token-consumer.service.js';
import { DatetimeUtils } from '../utils/datetime.js';

describe('BillingService', () => {
    let service: BillingService;
    const mockInfluxService = new MockInfluxService();
    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            imports: [
                forwardRef(() => InfluxModule),
                forwardRef(() => PrivateAPICustomerModule),
                forwardRef(() => PrivateAPIInvoicesModule),
                forwardRef(() => SchedulerModule),
                forwardRef(() => ContractModule),
                forwardRef(() => PrivateAPISettingsModule),
                BullModule.registerQueue({
                    name: 'scheduler_billing_queue',
                }),
            ],
            providers: [BillingService],
        })
            .overrideProvider(InfluxService)
            .useValue(mockInfluxService)
            .overrideProvider(TokenConsumerService)
            .useValue(createMock<TokenConsumerService>())
            .overrideProvider(getQueueOptionsToken())
            .useValue(createMock<QueueOptions>())
            .overrideProvider(getQueueToken('scheduler_queue'))
            .useValue(createMock<Queue>())
            .overrideProvider(getQueueToken('scheduler_billing_queue'))
            .useValue(createMock<Queue>())
            .compile();

        service = module.get<BillingService>(BillingService);
    });
    beforeEach(() => {
        jest.useRealTimers();
    });

    afterEach(() => {
        jest.useRealTimers();
        jest.clearAllMocks();
    });
    afterAll(() => {
        jest.clearAllTimers();
        jest.resetAllMocks();
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    it('Should correctly set start and end dates for annual billing', () => {
        jest.useFakeTimers('modern').setSystemTime(new Date('2023-09-01'));
        const {
            startTime,
            endTime,
            subscriptionEnd,
            subscriptionStart,
            currentBillingCycleEndTime,
            currentBillingCycleStartTime,
        } = Billing.billingCycleToTimeRange(ValidBillingCycles.annualToDate);

        const lastYearStringDate = new Date('2022-09-01').toISOString();
        const nextYearStringDate = new Date('2024-09-01').toISOString();
        const currentYearStringDate = new Date('2023-09-01').toISOString();
        expect(startTime).toEqual(lastYearStringDate);
        expect(endTime).toEqual(new Date('2023-08-31T23:59:59.999Z').toISOString());
        expect(subscriptionStart).toEqual(currentYearStringDate);
        expect(subscriptionEnd).toEqual(nextYearStringDate);
        expect(currentBillingCycleStartTime).toEqual(currentYearStringDate);
        expect(currentBillingCycleEndTime).toEqual(nextYearStringDate);

        jest.useRealTimers();
        jest.useFakeTimers('modern').setSystemTime(new Date('2023-01-01'));
        const {
            startTime: startTime2,
            endTime: endTime2,
            subscriptionEnd: subscriptionEnd2,
            subscriptionStart: subscriptionStart2,
            currentBillingCycleEndTime: currentBillingCycleEndTime2,
            currentBillingCycleStartTime: currentBillingCycleStartTime2,
        } = Billing.billingCycleToTimeRange(ValidBillingCycles.annualToDate);
        expect(startTime2).toEqual(new Date('2022-01-01T00:00:00.000Z').toISOString());
        expect(endTime2).toEqual(new Date('2022-12-31T23:59:59.999Z').toISOString());
        expect(subscriptionStart2).toEqual(new Date('2023-01-01T00:00:00.000Z').toISOString());
        expect(subscriptionEnd2).toEqual(new Date('2024-01-01T00:00:00.000Z').toISOString());
        expect(currentBillingCycleStartTime2).toEqual(new Date('2023-01-01T00:00:00.000Z').toISOString());
        expect(currentBillingCycleEndTime2).toEqual(new Date('2024-01-01T00:00:00.000Z').toISOString());

        jest.useRealTimers();
        jest.useFakeTimers('modern').setSystemTime(new Date('2023-12-31'));
        const {
            startTime: startTime3,
            endTime: endTime3,
            subscriptionEnd: subscriptionEnd3,
            subscriptionStart: subscriptionStart3,
            currentBillingCycleEndTime: currentBillingCycleEndTime3,
            currentBillingCycleStartTime: currentBillingCycleStartTime3,
        } = Billing.billingCycleToTimeRange(ValidBillingCycles.annualToDate);
        expect(startTime3).toEqual(new Date('2022-12-31T00:00:00.000Z').toISOString());
        expect(endTime3).toEqual(new Date('2023-12-30T23:59:59.999Z').toISOString());
        expect(subscriptionStart3).toEqual(new Date('2023-12-31T00:00:00.000Z').toISOString());
        expect(subscriptionEnd3).toEqual(new Date('2024-12-31T00:00:00.000Z').toISOString());
        expect(currentBillingCycleStartTime3).toEqual(new Date('2023-12-31T00:00:00.000Z').toISOString());
        expect(currentBillingCycleEndTime3).toEqual(new Date('2024-12-31T00:00:00.000Z').toISOString());
    });

    it('Should handle events without offeringId correctly', async () => {
        const customerId = randomUUID();
        const offeringId = randomUUID();
        const dimensionId = randomUUID();
        const businessID = 'foobar-production';
        const customerDbModelData = customerDBModelGenerator();
        mockInfluxService.getLatestCustomer.mockResolvedValue([
            {
                ...customerDbModelData,
                customerId,
                offeringId,
                offeringIds: JSON.stringify([offeringId]),
                offeringEnrollmentDate: DatetimeUtils.daysBeforeDate(new Date(), 10000).toISOString(),
            } as CustomerInfluxRow,
        ]);
        const offeringDBModel = offeringDBModelGenerator(offeringId, dimensionId);
        const dimensionDBModel = dimensionDBModelGenerator(dimensionId);
        mockInfluxService.getLatestOfferingConfig.mockResolvedValue([offeringDBModel]);
        mockInfluxService.getAggregateUsageForDimension.mockResolvedValue([
            aggregateUsageGenerator(dimensionId, offeringId),
        ]);
        mockInfluxService.getSingleDimension.mockImplementation(async () => [dimensionDBModel]);
        await service.create({ data: { scheduleParameters: { customerId }, businessID } as unknown } as any);
        expect(mockInfluxService.getLatestCustomer).toHaveBeenCalledWith({ businessID, customerId });
        expect(mockInfluxService.getLatestOfferingConfig).toHaveBeenCalledWith({ businessID, offeringId: offeringId });

        const { loadPoints, getPoint } = mockInfluxService;
        const { tag } = getPoint();
        expect(loadPoints).toHaveBeenCalledTimes(2);
        expect(tag).toHaveBeenCalledWith('customerId', customerId);
        expect(tag).toHaveBeenCalledWith('businessID', businessID);
        expect(tag).toHaveBeenCalledWith('invoiceId', expect.any(String));
        expect(tag).toHaveBeenCalledWith(
            'invoiceLineItems',
            JSON.stringify([
                { name: 'dimensionName Cool Value - Count - testOffering', quantity: 44.499, unitCost: 20 },
            ]),
        );
    });
    it('Should handle events with offeringId correctly', async () => {
        const customerId = randomUUID();
        const offeringId = randomUUID();
        const dimensionId = randomUUID();
        const businessID = 'foobar-production';
        const customerDbModelData = customerDBModelGenerator();
        mockInfluxService.getLatestCustomer.mockResolvedValue([
            {
                ...customerDbModelData,
                customerId,
                offeringId,
                offeringIds: JSON.stringify([offeringId]),
                offeringEnrollmentDate: DatetimeUtils.daysBeforeDate(new Date(), 10000).toISOString(),
            } as CustomerInfluxRow,
        ]);
        const offeringDBModel = offeringDBModelGenerator(offeringId, dimensionId);
        const dimensionDBModel = dimensionDBModelGenerator(dimensionId);
        mockInfluxService.getLatestOfferingConfig.mockResolvedValue([offeringDBModel]);
        mockInfluxService.getAggregateUsageForDimension.mockResolvedValue([
            aggregateUsageGenerator(dimensionId, offeringId),
        ]);
        mockInfluxService.getSingleDimension.mockImplementation(async () => [dimensionDBModel]);
        await service.create({
            data: { scheduleParameters: { customerId, offeringId }, businessID } as unknown,
        } as any);
        expect(mockInfluxService.getLatestCustomer).toHaveBeenCalledWith({ businessID, customerId });
        expect(mockInfluxService.getLatestOfferingConfig).toHaveBeenCalledWith({ businessID, offeringId });

        const { loadPoints, getPoint } = mockInfluxService;
        const { tag } = getPoint();
        expect(loadPoints).toHaveBeenCalledTimes(2);
        expect(tag).toHaveBeenCalledWith('customerId', customerId);
        expect(tag).toHaveBeenCalledWith('businessID', businessID);
        expect(tag).toHaveBeenCalledWith('invoiceId', expect.any(String));
        expect(tag).toHaveBeenCalledWith(
            'invoiceLineItems',
            JSON.stringify([
                { name: 'dimensionName Cool Value - Count - testOffering', quantity: 44.499, unitCost: 20 },
            ]),
        );
    });
});
