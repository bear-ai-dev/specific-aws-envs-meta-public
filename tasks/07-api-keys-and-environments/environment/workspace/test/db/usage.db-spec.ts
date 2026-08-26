import { InfluxService } from '../../src/influx/influx.service';
import { influx_token } from '../../integration/secret.json';
import { StandardMeasurementEntity } from '../../src/measurement-config/entities/standardMeasurement.entity';
import { productionBusinessID } from '../fixtures/data/user';
import { UsageEntity } from '../../src/usage/entities/usage.entity';
import { MeasurementFormat } from '../../src/measurement-config/entities/measurement.interface';
import { BucketsAPI, OrgsAPI } from '@influxdata/influxdb-client-apis';
import { HttpError, InfluxDB, Point } from '@influxdata/influxdb-client';
import { AggregationPurpose } from '../../src/customer/dto/AggregationPurpose';
import { aggregationInterval, aggregationMethod, roundingEnum } from '../../src/dimensions/dto/create-dimension.dto';
import { DatetimeUtils } from '../../src/utils/datetime';
import { sleep } from '../../src/utils/shared/utils';
import { randomUUID } from 'crypto';
import { Invoice, InvoiceLineItems } from '../../src/invoice/entities/invoice.entity';
import { InvoiceStatus } from '../../src/invoice/entities/InvoiceStatus';
process.env.INFLUX_URL = 'http://localhost:8086';
process.env.INFLUX_TOKEN = influx_token;
process.env.INFLUX_ORG = 'meteringco';
process.env.STAGE = 'db-test';
const ONE_DAY_IN_MS = 864e5;
describe('usage', () => {
    let influxService: InfluxService;
    beforeAll(async () => {
        const influx = new InfluxDB({
            url: process.env.INFLUX_URL as string,
            token: process.env.INFLUX_TOKEN,
        });
        const bucketsAPI = new BucketsAPI(influx);
        const bucketName = `${process.env.STAGE}-usage-data`;
        const orgsAPI = new OrgsAPI(influx);
        const organizations = await orgsAPI.getOrgs({ org: process.env.INFLUX_ORG });
        if (!organizations || !organizations.orgs || !organizations.orgs.length) {
            console.error(`No organization named "${process.env.INFLUX_ORG}" found!`);
        }
        const orgID = organizations?.orgs?.[0]?.id as string;
        console.log(`Using organization "${process.env.INFLUX_ORG}" identified by "${orgID}"`);
        try {
            const buckets = await bucketsAPI.getBuckets({
                orgID,
                name: bucketName,
            });
            if (buckets && buckets.buckets && buckets.buckets.length) {
                console.log(`Bucket named "${bucketName}" already exists"`);
                const bucketID = buckets.buckets[0].id as string;
                console.log(`*** Delete Bucket "${bucketName}" identified by "${bucketID}" ***`);
                await bucketsAPI.deleteBucketsID({ bucketID });
                const bucket = await bucketsAPI.postBuckets({
                    body: { orgID, name: bucketName },
                });
                console.log(`Bucket "${bucketName}" created with ID "${bucket.id}"`);
            } else {
                const bucket = await bucketsAPI.postBuckets({
                    body: { orgID, name: bucketName },
                });
                console.log(`Bucket "${bucketName}" created with ID "${bucket.id}"`);
            }
        } catch (e) {
            if (e instanceof HttpError && e.statusCode == 404) {
                const bucket = await bucketsAPI.postBuckets({
                    body: { orgID, name: bucketName },
                });
                console.log(`Bucket "${bucketName}" created with ID "${bucket.id}"`);
            } else {
                console.error(`Error occured while creating bucket for db test:${bucketName}`);
                throw e;
            }
        }
    });
    beforeEach(() => {
        jest.useFakeTimers().setSystemTime(new Date('2023-08-18'));
        influxService = new InfluxService();
    });

    afterEach(() => {
        jest.clearAllMocks();
        jest.useRealTimers();
    });
    test('loadPoints should load points into influxdb', async () => {
        const points: Point[] = [];
        const customerId = randomUUID();
        const dimensionId = randomUUID();
        for (let i = 0; i < 3; i++) {
            const measurementEntity = new StandardMeasurementEntity({
                dimensionId: `${dimensionId}_${i}`,
                customerId,
                recordValue: 10,
                timestamp: new Date(Date.now() - i * ONE_DAY_IN_MS).toISOString(),
                businessID: productionBusinessID,
                _measurement: UsageEntity._measurement,
            });
            points.push(MeasurementFormat.getPointForm(measurementEntity, influxService));
        }
        await influxService.loadPoints(`${process.env.STAGE}-usage-data`, process.env.INFLUX_ORG, points);
    });

    test('aggregateDimensionUsageQuery should handle last aggregations correctly', async () => {
        const points: Point[] = [];
        const customerId = randomUUID();
        const dimensionId = randomUUID();
        for (let i = 0; i < 10; i++) {
            const measurementEntity = new StandardMeasurementEntity({
                dimensionId,
                customerId,
                recordValue: i === 0 ? 10 : 100,
                timestamp: new Date(Date.now() - ONE_DAY_IN_MS - i * ONE_DAY_IN_MS).toISOString(),
                businessID: productionBusinessID,
                _measurement: UsageEntity._measurement,
            });
            points.push(MeasurementFormat.getPointForm(measurementEntity, influxService));
        }
        await influxService.loadPoints(`${process.env.STAGE}-usage-data`, process.env.INFLUX_ORG, points, true);
        const result = await influxService.aggregateDimensionUsageQuery({
            businessID: productionBusinessID,
            customerId,
            dimensionId,
            aggregationPurpose: AggregationPurpose.BILLING,
            argumentAggregationMethod: aggregationMethod.last,
            aggregationInterval: aggregationInterval.hour,
            startDate: DatetimeUtils.lastYearGivenDate(new Date()),
            endDate: new Date(),
            usageIncrement: 1,
            rounding: roundingEnum.ceiling,
            queryStartTime: DatetimeUtils.firstDayOfMonth(),
            continious: true,
        });
        // Hours between start and end date
        const hours = Math.ceil((new Date().getTime() - DatetimeUtils.firstDayOfMonth().getTime()) / 36e5);
        expect(result.length).toBe(hours);
        expect(result[result?.length - 1]._value).toBe(10);
    });
    test('aggregateDimensionUsageQuery should handle sum aggregations correctly', async () => {
        const points: Point[] = [];
        const customerId = randomUUID();
        const dimensionId = randomUUID();
        for (let i = 0; i < 10; i++) {
            const measurementEntity = new StandardMeasurementEntity({
                dimensionId,
                customerId,
                recordValue: 10,
                timestamp: new Date(Date.now() - ONE_DAY_IN_MS - i * ONE_DAY_IN_MS).toISOString(),
                businessID: productionBusinessID,
                _measurement: UsageEntity._measurement,
            });
            points.push(MeasurementFormat.getPointForm(measurementEntity, influxService));
        }
        await influxService.loadPoints(`${process.env.STAGE}-usage-data`, process.env.INFLUX_ORG, points, true);
        const result = await influxService.aggregateDimensionUsageQuery({
            businessID: productionBusinessID,
            customerId,
            dimensionId,
            aggregationPurpose: AggregationPurpose.BILLING,
            argumentAggregationMethod: aggregationMethod.sum,
            aggregationInterval: aggregationInterval.month,
            startDate: DatetimeUtils.firstDayOfMonth(),
            endDate: new Date(),
            usageIncrement: 1,
            rounding: roundingEnum.ceiling,
            queryStartTime: DatetimeUtils.firstDayOfMonth(),
            continious: false,
        });
        expect(result.length).toBe(1);
        expect(result[0]._value).toBe(100);
    });
    test('aggregateDimensionUsageQuery should handle average aggregations correctly', async () => {
        const points: Point[] = [];
        const customerId = randomUUID();
        const dimensionId = randomUUID();
        for (let i = 0; i < 10; i++) {
            const measurementEntity = new StandardMeasurementEntity({
                dimensionId,
                customerId,
                recordValue: i,
                timestamp: new Date(Date.now() - ONE_DAY_IN_MS - i * ONE_DAY_IN_MS).toISOString(),
                businessID: productionBusinessID,
                _measurement: UsageEntity._measurement,
            });
            points.push(MeasurementFormat.getPointForm(measurementEntity, influxService));
        }
        await influxService.loadPoints(`${process.env.STAGE}-usage-data`, process.env.INFLUX_ORG, points, true);
        const result = await influxService.aggregateDimensionUsageQuery({
            businessID: productionBusinessID,
            customerId,
            dimensionId,
            aggregationPurpose: AggregationPurpose.BILLING,
            argumentAggregationMethod: aggregationMethod.average,
            aggregationInterval: aggregationInterval.month,
            startDate: DatetimeUtils.firstDayOfMonth(),
            endDate: new Date(),
            usageIncrement: 1,
            rounding: roundingEnum.ceiling,
            queryStartTime: DatetimeUtils.firstDayOfMonth(),
            continious: false,
        });
        expect(result.length).toBe(1);
        expect(result[0]._value).toBe(5);
    });
    test('aggregateDimensionUsageQuery should handle min aggregations correctly', async () => {
        const points: Point[] = [];
        const customerId = randomUUID();
        const dimensionId = randomUUID();
        for (let i = 1; i < 10; i++) {
            const measurementEntity = new StandardMeasurementEntity({
                dimensionId,
                customerId,
                recordValue: i,
                timestamp: new Date(Date.now() - ONE_DAY_IN_MS - i * ONE_DAY_IN_MS).toISOString(),
                businessID: productionBusinessID,
                _measurement: UsageEntity._measurement,
            });
            points.push(MeasurementFormat.getPointForm(measurementEntity, influxService));
        }
        await influxService.loadPoints(`${process.env.STAGE}-usage-data`, process.env.INFLUX_ORG, points, true);
        const result = await influxService.aggregateDimensionUsageQuery({
            businessID: productionBusinessID,
            customerId,
            dimensionId,
            aggregationPurpose: AggregationPurpose.BILLING,
            argumentAggregationMethod: aggregationMethod.min,
            aggregationInterval: aggregationInterval.month,
            startDate: DatetimeUtils.firstDayOfMonth(),
            endDate: new Date(),
            usageIncrement: 1,
            rounding: roundingEnum.ceiling,
            queryStartTime: DatetimeUtils.firstDayOfMonth(),
            continious: false,
        });
        expect(result.length).toBe(1);
        expect(result[0]._value).toBe(1);
    });
    test('aggregateDimensionUsageQuery should handle max aggregations correctly', async () => {
        const points: Point[] = [];
        const customerId = randomUUID();
        const dimensionId = randomUUID();
        for (let i = 1; i < 10; i++) {
            const measurementEntity = new StandardMeasurementEntity({
                dimensionId,
                customerId,
                recordValue: i,
                timestamp: new Date(Date.now() - ONE_DAY_IN_MS - i * ONE_DAY_IN_MS).toISOString(),
                businessID: productionBusinessID,
                _measurement: UsageEntity._measurement,
            });
            points.push(MeasurementFormat.getPointForm(measurementEntity, influxService));
        }
        await influxService.loadPoints(`${process.env.STAGE}-usage-data`, process.env.INFLUX_ORG, points, true);
        const result = await influxService.aggregateDimensionUsageQuery({
            businessID: productionBusinessID,
            customerId,
            dimensionId,
            aggregationPurpose: AggregationPurpose.BILLING,
            argumentAggregationMethod: aggregationMethod.max,
            aggregationInterval: aggregationInterval.month,
            startDate: DatetimeUtils.firstDayOfMonth(),
            endDate: new Date(),
            usageIncrement: 1,
            rounding: roundingEnum.ceiling,
            queryStartTime: DatetimeUtils.firstDayOfMonth(),
            continious: false,
        });
        expect(result.length).toBe(1);
        expect(result[0]._value).toBe(9);
    });

    test('aggregateDimensionUsageQuery should handle count aggregations correctly', async () => {
        const points: Point[] = [];
        const customerId = randomUUID();
        const dimensionId = randomUUID();
        for (let i = 1; i < 10; i++) {
            const measurementEntity = new StandardMeasurementEntity({
                dimensionId,
                customerId,
                recordValue: i,
                timestamp: new Date(Date.now() - ONE_DAY_IN_MS - i * ONE_DAY_IN_MS).toISOString(),
                businessID: productionBusinessID,
                _measurement: UsageEntity._measurement,
            });
            points.push(MeasurementFormat.getPointForm(measurementEntity, influxService));
        }
        await influxService.loadPoints(`${process.env.STAGE}-usage-data`, process.env.INFLUX_ORG, points, true);
        const result = await influxService.aggregateDimensionUsageQuery({
            businessID: productionBusinessID,
            customerId,
            dimensionId,
            aggregationPurpose: AggregationPurpose.BILLING,
            argumentAggregationMethod: aggregationMethod.count,
            aggregationInterval: aggregationInterval.month,
            startDate: DatetimeUtils.firstDayOfMonth(),
            endDate: new Date(),
            usageIncrement: 1,
            rounding: roundingEnum.ceiling,
            queryStartTime: DatetimeUtils.firstDayOfMonth(),
            continious: false,
        });
        expect(result.length).toBe(1);
        expect(result[0]._value).toBe(9);
    });
    test('aggregateDimensionUsageQuery should properly divide up usage for aggregation interval hour', async () => {
        const points: Point[] = [];
        const customerId = randomUUID();
        const dimensionId = randomUUID();
        for (let i = 0; i < 3; i++) {
            const measurementEntity = new StandardMeasurementEntity({
                dimensionId,
                customerId,
                recordValue: 10,
                timestamp: new Date(Date.now() - ONE_DAY_IN_MS - i * ONE_DAY_IN_MS).toISOString(),
                businessID: productionBusinessID,
                _measurement: UsageEntity._measurement,
            });
            points.push(MeasurementFormat.getPointForm(measurementEntity, influxService));
        }
        await influxService.loadPoints(`${process.env.STAGE}-usage-data`, process.env.INFLUX_ORG, points);
        const result = await influxService.aggregateDimensionUsageQuery({
            businessID: productionBusinessID,
            customerId,
            dimensionId,
            aggregationPurpose: AggregationPurpose.BILLING,
            argumentAggregationMethod: aggregationMethod.sum,
            aggregationInterval: aggregationInterval.hour,
            startDate: DatetimeUtils.firstDayOfMonth(),
            endDate: new Date(),
            usageIncrement: 1,
            rounding: roundingEnum.ceiling,
            queryStartTime: DatetimeUtils.firstDayOfMonth(),
            continious: false,
        });
        const hours = Math.ceil((new Date().getTime() - DatetimeUtils.firstDayOfMonth().getTime()) / 36e5);
        expect(result.length).toBe(hours);
        expect(result.filter((item) => item._value === 10).length).toBe(3);
    });
    test('aggregateDimensionUsageQuery should handle grouping usage by metadata correctly for a base case', async () => {
        const points: Point[] = [];
        const customerId = randomUUID();
        const dimensionId = randomUUID();
        for (let i = 0; i < 10; i++) {
            const measurementEntity = new StandardMeasurementEntity({
                dimensionId,
                customerId,
                recordValue: 10,
                timestamp: new Date(Date.now() - ONE_DAY_IN_MS - i * ONE_DAY_IN_MS).toISOString(),
                businessID: productionBusinessID,
                _measurement: UsageEntity._measurement,
                metadata: {
                    test: 'test',
                    // If the index is even, then regionValue is "even" otherwise its "odd"
                    regionValue: i % 2 === 0 ? 'even' : 'odd',
                },
            });
            points.push(MeasurementFormat.getPointForm(measurementEntity, influxService));
        }
        await influxService.loadPoints(`${process.env.STAGE}-usage-data`, process.env.INFLUX_ORG, points, true);
        const result = await influxService.aggregateDimensionUsageQuery({
            businessID: productionBusinessID,
            customerId,
            dimensionId,
            aggregationPurpose: AggregationPurpose.BILLING,
            argumentAggregationMethod: aggregationMethod.sum,
            aggregationInterval: aggregationInterval.month,
            startDate: DatetimeUtils.firstDayOfMonth(),
            endDate: new Date(),
            usageIncrement: 1,
            rounding: roundingEnum.ceiling,
            queryStartTime: DatetimeUtils.firstDayOfMonth(),
            continious: false,
            metadataGroups: {
                regionValue: 'even',
            },
        });
        console.log(JSON.stringify(result));
        expect(result.length).toBe(2);
        expect(result[0]._value).toBe(50);
        expect(result[1]._value).toBe(50);
    });
    test('aggregateDimensionUsageQuery should handle grouping usage by metadata correctly with multiple metadata groups', async () => {
        const points: Point[] = [];
        const customerId = randomUUID();
        const dimensionId = randomUUID();
        let counter = 0;
        for (let i = 0; i < 20; i++) {
            // timestamp should be 1 hour ago per index
            const timestamp = new Date(Date.now() - ONE_DAY_IN_MS - i * 36e5).toISOString();
            const deploymentMode = i % 2 === 0 ? 'even' : 'odd';
            const instanceType = ['t2.micro', 't2.small', 't2.medium', 't2.large', 't3.medium'][counter % 5];
            const measurementEntity = new StandardMeasurementEntity({
                dimensionId,
                customerId,
                recordValue: 10,
                timestamp,
                businessID: productionBusinessID,
                _measurement: UsageEntity._measurement,
                metadata: {
                    test: 'test',
                    // If the index is even, then regionValue is "even" otherwise its "odd"
                    deploymentMode,
                    // assign an instance value from a small list of string using the index
                    instanceType,
                },
            });
            points.push(MeasurementFormat.getPointForm(measurementEntity, influxService));
            counter += 3;
        }
        await influxService.loadPoints(`${process.env.STAGE}-usage-data`, process.env.INFLUX_ORG, points, true);
        const result = await influxService.aggregateDimensionUsageQuery({
            businessID: productionBusinessID,
            customerId,
            dimensionId,
            aggregationPurpose: AggregationPurpose.BILLING,
            argumentAggregationMethod: aggregationMethod.sum,
            aggregationInterval: aggregationInterval.month,
            startDate: DatetimeUtils.firstDayOfMonth(),
            endDate: new Date(),
            usageIncrement: 1,
            rounding: roundingEnum.ceiling,
            queryStartTime: DatetimeUtils.firstDayOfMonth(),
            continious: false,
            metadataGroups: {
                deploymentMode: 'even',
                instanceType: 't2.micro',
            },
        });

        expect(result.length).toBe(10);
        console.log(JSON.stringify(result));
        result.forEach((item) => {
            expect(item._value).toBe(20);
        });
    });

    test('aggregateDimensionUsageQuery should handle grouping usage by metadata correctly with multiple metadata groups and MAX aggregation method', async () => {
        const points: Point[] = [];
        const customerId = randomUUID();
        const dimensionId = randomUUID();
        let counter = 0;
        for (let i = 0; i < 20; i++) {
            // timestamp should be 1 hour ago per index
            const timestamp = new Date(Date.now() - ONE_DAY_IN_MS - i * 36e5).toISOString();
            const deploymentMode = i % 2 === 0 ? 'even' : 'odd';
            const instanceType = ['t2.micro', 't2.small', 't2.medium', 't2.large', 't3.medium'][counter % 5];
            const measurementEntity = new StandardMeasurementEntity({
                dimensionId,
                customerId,
                recordValue: i,
                timestamp,
                businessID: productionBusinessID,
                _measurement: UsageEntity._measurement,
                metadata: {
                    test: 'test',
                    // If the index is even, then regionValue is "even" otherwise its "odd"
                    deploymentMode,
                    // assign an instance value from a small list of string using the index
                    instanceType,
                },
            });
            points.push(MeasurementFormat.getPointForm(measurementEntity, influxService));
            counter += 3;
        }
        await influxService.loadPoints(`${process.env.STAGE}-usage-data`, process.env.INFLUX_ORG, points, true);
        const result = await influxService.aggregateDimensionUsageQuery({
            businessID: productionBusinessID,
            customerId,
            dimensionId,
            aggregationPurpose: AggregationPurpose.BILLING,
            argumentAggregationMethod: aggregationMethod.max,
            aggregationInterval: aggregationInterval.month,
            startDate: DatetimeUtils.firstDayOfMonth(),
            endDate: new Date(),
            usageIncrement: 1,
            rounding: roundingEnum.ceiling,
            queryStartTime: DatetimeUtils.firstDayOfMonth(),
            continious: false,
            metadataGroups: {
                deploymentMode: 'even',
                instanceType: 't2.micro',
            },
        });

        expect(result.length).toBe(10);

        result
            .map(({ _value }) => _value)
            .sort()
            .forEach((item, index) => {
                expect(item).toBe(index + 10);
            });
    });
    test('aggregateDimensionUsageQuery should handle grouping usage by metadata correctly with multiple metadata groups and MIN aggregation method', async () => {
        const points: Point[] = [];
        const customerId = randomUUID();
        const dimensionId = randomUUID();
        let counter = 0;
        for (let i = 0; i < 20; i++) {
            // timestamp should be 1 hour ago per index
            const timestamp = new Date(Date.now() - ONE_DAY_IN_MS - i * 36e5).toISOString();
            const deploymentMode = i % 2 === 0 ? 'even' : 'odd';
            const instanceType = ['t2.micro', 't2.small', 't2.medium', 't2.large', 't3.medium'][counter % 5];
            const measurementEntity = new StandardMeasurementEntity({
                dimensionId,
                customerId,
                recordValue: i,
                timestamp,
                businessID: productionBusinessID,
                _measurement: UsageEntity._measurement,
                metadata: {
                    test: 'test',
                    // If the index is even, then regionValue is "even" otherwise its "odd"
                    deploymentMode,
                    // assign an instance value from a small list of string using the index
                    instanceType,
                },
            });
            points.push(MeasurementFormat.getPointForm(measurementEntity, influxService));
            counter += 3;
        }
        await influxService.loadPoints(`${process.env.STAGE}-usage-data`, process.env.INFLUX_ORG, points, true);
        const result = await influxService.aggregateDimensionUsageQuery({
            businessID: productionBusinessID,
            customerId,
            dimensionId,
            aggregationPurpose: AggregationPurpose.BILLING,
            argumentAggregationMethod: aggregationMethod.min,
            aggregationInterval: aggregationInterval.month,
            startDate: DatetimeUtils.firstDayOfMonth(),
            endDate: new Date(),
            usageIncrement: 1,
            rounding: roundingEnum.ceiling,
            queryStartTime: DatetimeUtils.firstDayOfMonth(),
            continious: false,
            metadataGroups: {
                deploymentMode: 'even',
                instanceType: 't2.micro',
            },
        });

        expect(result.length).toBe(10);

        result
            .map(({ _value }) => _value)
            .sort()
            .forEach((item, index) => {
                expect(item).toBe(index);
            });
    });
    test('aggregateDimensionUsageQuery should handle grouping usage by metadata correctly with multiple metadata groups and a continious sample type', async () => {
        const points: Point[] = [];
        const customerId = randomUUID();
        const dimensionId = randomUUID();
        let counter = 0;
        for (let i = 0; i < 20; i++) {
            // timestamp should be last month per index
            let timestamp: Date | string = DatetimeUtils.lastYearGivenDate(new Date());
            timestamp.setUTCDate(timestamp.getUTCDate() + i);
            timestamp = timestamp.toISOString();
            const deploymentMode = i % 2 === 0 ? 'even' : 'odd';
            const instanceType = ['t2.micro', 't2.small', 't2.medium', 't2.large', 't3.medium'][counter % 5];
            console.log(timestamp, instanceType, deploymentMode);
            const measurementEntity = new StandardMeasurementEntity({
                dimensionId,
                customerId,
                recordValue: i,
                timestamp,
                businessID: productionBusinessID,
                _measurement: UsageEntity._measurement,
                metadata: {
                    test: 'test',
                    // If the index is even, then regionValue is "even" otherwise its "odd"
                    deploymentMode,
                    // assign an instance value from a small list of string using the index
                    instanceType,
                },
            });
            points.push(MeasurementFormat.getPointForm(measurementEntity, influxService));
            counter += 3;
        }
        await influxService.loadPoints(`${process.env.STAGE}-usage-data`, process.env.INFLUX_ORG, points, true);
        const result = await influxService.aggregateDimensionUsageQuery({
            businessID: productionBusinessID,
            customerId,
            dimensionId,
            aggregationPurpose: AggregationPurpose.BILLING,
            argumentAggregationMethod: aggregationMethod.last,
            aggregationInterval: aggregationInterval.month,
            startDate: new Date('January 1, 2021 00:00:00'),
            endDate: new Date(),
            usageIncrement: 1,
            rounding: roundingEnum.ceiling,
            queryStartTime: DatetimeUtils.firstDayOfMonth(),
            continious: true,
            metadataGroups: {
                deploymentMode: 'even',
                instanceType: 't2.micro',
            },
        });

        expect(result.length).toBe(10);

        result
            .map(({ _value }) => _value)
            .sort()
            .forEach((item, index) => {
                expect(item).toBe(index + 10);
            });
    });

    xtest('queryForLedger should properly query for invoice data', async () => {
        const points: Point[] = [];
        const customerId = randomUUID();
        for (let i = 0; i < 10; i++) {
            const lineItems = new InvoiceLineItems();
            lineItems.addLineItem({
                name: 'Compute Hours',
                description: 'Cool Corp Compute',
                quantity: 1,
                unitCost: 10,
            });
            const invoice = new Invoice({
                customerId,
                businessID: productionBusinessID,
                invoiceLineItems: lineItems,
                invoiceDate: new Date(Date.now() - ONE_DAY_IN_MS - i * ONE_DAY_IN_MS).toISOString(),
                invoiceStatus: InvoiceStatus.PAID,
                totalAmountWithoutTax: 10,
            });
            const [invoicePoint] = invoice.toDBModel();
            invoicePoint.timestamp(new Date(invoice.invoiceDate));
            points.push(invoicePoint);
        }
        console.log(`${process.env.STAGE}-usage-data`);
        await influxService.loadPoints(`${process.env.STAGE}-usage-data`, process.env.INFLUX_ORG, points, true);
        const result = await influxService.queryForLedger({
            businessID: productionBusinessID,
            start: DatetimeUtils.firstDayOfMonth(),
            end: new Date(),
            measurement: Invoice._measurement,
            orFilters: {
                invoiceStatus: [InvoiceStatus.PAID, InvoiceStatus.OPEN],
            },
            groupBy: ['invoiceId'],
            uniqueFilters: ['invoiceId'],
        });
        console.log(result);
    });
});
