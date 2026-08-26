import { Test, TestingModule } from '@nestjs/testing';
import { SettingsService } from './settings.service.js';
import { createMock } from '@golevelup/ts-jest';
import { InfluxService } from '../influx/influx.service.js';
import { PortalPagesConfigurationDto } from '../portal/dto/configuration.dto.js';
import { SchedulerService } from '../scheduler/scheduler.service.js';
import { ComputeCostSource, InvoiceGeneration, UpdateSettingsDto } from './dto/update-settings.dto.js';
import { InvoiceApproval } from './dto/InvoiceApproval.js';
import { plainToInstance } from 'class-transformer';

describe('SettingService', () => {
    let service: SettingsService;
    let influxService: InfluxService;
    let schedulerService: SchedulerService;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [SettingsService],
        })
            .useMocker(createMock)
            .compile();

        service = module.get(SettingsService);
        influxService = module.get(InfluxService);
        schedulerService = module.get(SchedulerService);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    describe('findLatestSetting', () => {
        const businessID = 'some-business-id';
        const setting = {
            logoUrl: 'https://www.google.com/images/branding/googlelogo/1x/googlelogo_color_272x92dp.png',
            businessID,
        };

        it('should return latest setting if it is available', async () => {
            jest.spyOn(influxService, 'getLatestSettings').mockResolvedValueOnce([setting]);

            const result = await service.findLatestSetting({ businessID });

            expect(result.logoUrl).toEqual(setting.logoUrl);
            expect(result.businessID).toEqual(setting.businessID);
        });

        it('should return new setting if the latest setting is unavailable', async () => {
            jest.spyOn(influxService, 'getLatestSettings').mockResolvedValueOnce([]);

            const result = await service.findLatestSetting({ businessID });

            expect(result.logoUrl).toEqual('');
            expect(result.businessID).toEqual(businessID);
        });
    });

    describe('update', () => {
        const businessID = 'some-business-id';
        const subject = 'some-subject';
        const fields = {
            logoUrl: 'https://www.google.com/images/branding/googlelogo/1x/googlelogo_color_272x92dp.png',
        };

        it('should update setting', async () => {
            jest.spyOn(influxService, 'loadPoints').mockResolvedValueOnce();

            const result = await service.update({ businessID, subject, ...fields });
            expect(influxService.loadPoints).toBeCalledTimes(1);
            expect(result.message).toEqual('Setting updated successfully');
        });
        it('Should handle portal configuration update', async () => {
            jest.spyOn(influxService, 'loadPoints').mockResolvedValueOnce();

            const sampleRequest: PortalPagesConfigurationDto = {
                businessID: 'foobar',
                subject: 'foobar1',
                pages: {
                    invoice: {
                        text: 'invoice',
                        enabled: true,
                    },
                    payment: {
                        text: 'payment',
                        enabled: true,
                    },
                    offering: {
                        text: 'offerings',
                        enabled: true,
                        offerings: [],
                        appearance: {
                            background: '#ffffff',
                        },
                    },
                },
            };
            const result = await service.update(sampleRequest);
            expect(influxService.loadPoints).toBeCalledTimes(1);

            expect(result.message).toEqual('Setting updated successfully');
        });
    });

    describe('partial updates', () => {
        const businessID = 'some-business-id';
        const storedSettings = {
            _value: 'Stored Business',
            businessID,
            addressLine1: '1 Main Street',
            addressLine2: 'Suite 5',
            city: 'San Francisco',
            postalCode: '94188',
            supportEmail: 'support@stored.example',
            invoiceApproval: InvoiceApproval.automatic,
            invoiceGeneration: InvoiceGeneration.consolidatedPerBillingCycle,
            sendInvoiceEmail: 'false',
            pages: JSON.stringify({
                invoice: { enabled: true, text: 'Bills' },
                payment: { enabled: true, text: 'Pay Here' },
                offering: {
                    enabled: true,
                    text: 'Plans',
                    appearance: { background: '#ffffff', accent: '#000000' },
                },
            }),
        };

        beforeEach(() => {
            jest.spyOn(influxService, 'getLatestSettings').mockResolvedValue([storedSettings]);
            jest.spyOn(influxService, 'loadPoints').mockResolvedValue();
        });

        it('should keep the stored value of every field the caller did not send', async () => {
            const { data } = await service.update({ businessID, postalCode: '94199' });

            expect(data[0]).toMatchObject({
                businessName: 'Stored Business',
                addressLine1: '1 Main Street',
                addressLine2: 'Suite 5',
                city: 'San Francisco',
                postalCode: '94199',
                supportEmail: 'support@stored.example',
                invoiceApproval: InvoiceApproval.automatic,
                invoiceGeneration: InvoiceGeneration.consolidatedPerBillingCycle,
                sendInvoiceEmail: 'false',
            });
            expect(data[0].pages).toEqual(JSON.parse(storedSettings.pages));
        });

        it('should write the fields the caller sent, even when they are blank', async () => {
            const { data } = await service.update({ businessID, addressLine2: '' });

            expect(data[0].addressLine2).toEqual('');
            expect(data[0].addressLine1).toEqual('1 Main Street');
        });

        it('should leave the other portal pages alone when one page is named', async () => {
            const body = plainToInstance(UpdateSettingsDto, { pages: { payment: { text: 'Checkout' } } });

            const { data } = await service.update({ ...body, businessID });

            expect(data[0].pages).toEqual({
                invoice: { enabled: true, text: 'Bills' },
                payment: { enabled: true, text: 'Checkout' },
                offering: {
                    enabled: true,
                    text: 'Plans',
                    appearance: { background: '#ffffff', accent: '#000000' },
                },
            });
        });

        it('should leave the rest of the appearance block alone when one of its entries is named', async () => {
            const body = plainToInstance(UpdateSettingsDto, {
                pages: { offering: { appearance: { accent: '#abcdef' } } },
            });

            const { data } = await service.update({ ...body, businessID });

            expect(data[0].pages.offering).toEqual({
                enabled: true,
                text: 'Plans',
                appearance: { background: '#ffffff', accent: '#abcdef' },
            });
        });
    });

    describe('compute cost collection', () => {
        const businessID = 'some-business-id';
        const subject = 'some-subject';

        beforeEach(() => {
            jest.spyOn(influxService, 'loadPoints').mockResolvedValue();
        });

        it('should start the hourly collection when the compute cost source is turned on', async () => {
            jest.spyOn(influxService, 'getLatestSettings').mockResolvedValue([{ businessID }]);

            await service.update({ businessID, subject, computeCostSource: ComputeCostSource.eks });

            expect(schedulerService.create).toBeCalledTimes(1);
            expect(schedulerService.remove).toBeCalledTimes(0);
        });

        it('should wind the hourly collection down when the compute cost source is turned off', async () => {
            jest.spyOn(influxService, 'getLatestSettings').mockResolvedValue([
                { businessID, computeCostSource: ComputeCostSource.eks },
            ]);

            await service.update({ businessID, subject, computeCostSource: ComputeCostSource.none });

            expect(schedulerService.remove).toBeCalledTimes(1);
            expect(schedulerService.create).toBeCalledTimes(0);
        });

        it('should still record the settings when the collection schedule cannot be reconciled', async () => {
            jest.spyOn(influxService, 'getLatestSettings').mockResolvedValue([{ businessID }]);
            jest.spyOn(schedulerService, 'create').mockRejectedValueOnce(new Error('queue is down'));

            const result = await service.update({ businessID, subject, computeCostSource: ComputeCostSource.eks });

            expect(influxService.loadPoints).toBeCalledTimes(1);
            expect(result.message).toEqual('Setting updated successfully');
        });

        it('should do neither when the update restates the compute cost source already stored', async () => {
            jest.spyOn(influxService, 'getLatestSettings').mockResolvedValue([
                { businessID, computeCostSource: ComputeCostSource.eks },
            ]);

            await service.update({ businessID, subject, computeCostSource: ComputeCostSource.eks });
            await service.update({ businessID, subject, postalCode: '94199' });

            expect(schedulerService.create).toBeCalledTimes(0);
            expect(schedulerService.remove).toBeCalledTimes(0);
        });
    });

    describe('updateProfile', () => {
        const businessID = 'some-business-id';

        it('should save the profile field set over the settings document', async () => {
            jest.spyOn(influxService, 'getLatestSettings').mockResolvedValue([
                {
                    _value: 'Stored Business',
                    businessID,
                    addressLine1: '1 Main Street',
                    city: 'San Francisco',
                    invoiceApproval: InvoiceApproval.automatic,
                },
            ]);
            jest.spyOn(influxService, 'loadPoints').mockResolvedValue();

            const response = await service.updateProfile({ businessID, city: 'Oakland' });

            expect(influxService.loadPoints).toBeCalledTimes(1);
            expect(response.data[0]).toMatchObject({
                businessName: 'Stored Business',
                addressLine1: '1 Main Street',
                city: 'Oakland',
            });
        });
    });
});
