import { Test, TestingModule } from '@nestjs/testing';
import { SettingsService } from './settings.service.js';
import { createMock } from '@golevelup/ts-jest';
import { InfluxService } from '../influx/influx.service.js';
import { PortalPagesConfigurationDto } from '../portal/dto/configuration.dto.js';
import { SchedulerService } from '../scheduler/scheduler.service.js';
import { ComputeCostSource, SendInvoiceEmail } from './dto/update-settings.dto.js';
import { InvoiceApproval } from './dto/InvoiceApproval.js';
import { InvoiceGeneration } from './dto/update-settings.dto.js';

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
    describe('update merging', () => {
        const businessID = 'some-business-id';
        const storedPages = {
            invoice: { enabled: true, text: 'Your invoices' },
            payment: { enabled: true, text: 'Pay a bill' },
            offering: {
                enabled: true,
                text: 'Choose a plan',
                appearance: { accent: '#1f6feb', border: '#d0d7de' },
            },
        };
        const storedSetting = {
            businessID,
            _value: 'Orchard Systems',
            addressLine1: '12 Mill Lane',
            addressLine2: 'Unit 4',
            city: 'Cambridge',
            postalCode: 'CB1 1AA',
            supportEmail: 'billing@orchard.example',
            invoiceApproval: InvoiceApproval.automatic,
            invoiceGeneration: InvoiceGeneration.consolidatedPerBillingCycle,
            sendInvoiceEmail: SendInvoiceEmail.doNotSend,
            computeCostSource: ComputeCostSource.eks,
            pages: JSON.stringify(storedPages),
        };

        const stubStoredSetting = (overrides = {}) =>
            jest.spyOn(influxService, 'getLatestSettings').mockResolvedValue([{ ...storedSetting, ...overrides }]);

        it('should only write the fields that were sent, keeping everything else as stored', async () => {
            stubStoredSetting();

            const {
                data: [setting],
            } = await service.update({ businessID, postalCode: 'CB2 1RX' });

            expect(setting.postalCode).toEqual('CB2 1RX');
            expect(setting.businessName).toEqual('Orchard Systems');
            expect(setting.addressLine1).toEqual('12 Mill Lane');
            expect(setting.invoiceApproval).toEqual(InvoiceApproval.automatic);
            expect(setting.invoiceGeneration).toEqual(InvoiceGeneration.consolidatedPerBillingCycle);
            expect(setting.sendInvoiceEmail).toEqual(SendInvoiceEmail.doNotSend);
            expect(setting.supportEmail).toEqual('billing@orchard.example');
            expect(setting.pages).toEqual(storedPages);
        });

        it('should write a field that was sent blank', async () => {
            stubStoredSetting();

            const {
                data: [setting],
            } = await service.update({ businessID, addressLine2: '' });

            expect(setting.addressLine2).toEqual('');
            expect(setting.addressLine1).toEqual('12 Mill Lane');
            expect(setting.businessName).toEqual('Orchard Systems');
        });

        it('should leave the pages that were not sent alone', async () => {
            stubStoredSetting();

            const {
                data: [setting],
            } = await service.update({ businessID, pages: { invoice: { text: 'Bills' } } });

            expect(setting.pages.invoice).toEqual({ enabled: true, text: 'Bills' });
            expect(setting.pages.payment).toEqual(storedPages.payment);
            expect(setting.pages.offering).toEqual(storedPages.offering);
        });

        it('should leave the rest of an appearance block alone when a single value is sent', async () => {
            stubStoredSetting();

            const {
                data: [setting],
            } = await service.update({
                businessID,
                pages: { offering: { appearance: { accent: '#ff0000' } } },
            });

            expect(setting.pages.offering.text).toEqual('Choose a plan');
            expect(setting.pages.offering.appearance).toEqual({ accent: '#ff0000', border: '#d0d7de' });
            expect(setting.pages.invoice).toEqual(storedPages.invoice);
        });

        it('should start the hourly compute cost collection when the compute cost source is turned on', async () => {
            stubStoredSetting({ computeCostSource: ComputeCostSource.none });

            await service.update({ businessID, subject: 'some-subject', computeCostSource: ComputeCostSource.eks });

            expect(schedulerService.create).toBeCalledTimes(1);
            expect((schedulerService.create as jest.Mock).mock.calls[0][0]).toMatchObject({
                businessID,
                schedulerID: `${businessID}-getAndCommitPODCost`,
                scheduleParameters: { costType: ComputeCostSource.eks },
            });
            expect(schedulerService.remove).not.toBeCalled();
        });

        it('should wind the hourly compute cost collection down when the compute cost source is turned off', async () => {
            stubStoredSetting({ computeCostSource: ComputeCostSource.eks });

            await service.update({ businessID, subject: 'some-subject', computeCostSource: ComputeCostSource.none });

            expect(schedulerService.remove).toBeCalledWith({
                businessID,
                schedulerID: `${businessID}-getAndCommitPODCost`,
            });
            expect(schedulerService.create).not.toBeCalled();
        });

        it('should not touch the collection when the compute cost source is restated or untouched', async () => {
            stubStoredSetting({ computeCostSource: ComputeCostSource.eks });

            await service.update({ businessID, subject: 'some-subject', computeCostSource: ComputeCostSource.eks });
            await service.update({ businessID, subject: 'some-subject', postalCode: 'CB2 1RX' });

            expect(schedulerService.create).not.toBeCalled();
            expect(schedulerService.remove).not.toBeCalled();
        });
    });

    describe('updateProfile', () => {
        const businessID = 'some-business-id';

        it('should save the profile fields over the settings document without disturbing the rest', async () => {
            jest.spyOn(influxService, 'getLatestSettings').mockResolvedValue([
                {
                    businessID,
                    _value: 'Kite Analytics',
                    addressLine1: '4 Harbour Road',
                    city: 'Bristol',
                    invoiceApproval: InvoiceApproval.automatic,
                },
            ]);

            const { data, message } = await service.updateProfile({
                businessID,
                subject: 'some-subject',
                postalCode: 'BS1 5TY',
                supportEmail: 'help@kite.example',
            });

            expect(message).toEqual('Business profile updated successfully');
            expect(data[0].postalCode).toEqual('BS1 5TY');
            expect(data[0].supportEmail).toEqual('help@kite.example');
            expect(data[0].businessName).toEqual('Kite Analytics');
            expect(data[0].addressLine1).toEqual('4 Harbour Road');
            expect(data[0].city).toEqual('Bristol');
            expect(influxService.loadPoints).toBeCalledTimes(1);
        });
    });
});
