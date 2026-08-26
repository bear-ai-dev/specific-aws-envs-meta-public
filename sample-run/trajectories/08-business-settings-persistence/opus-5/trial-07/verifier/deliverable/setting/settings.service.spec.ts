import { Test, TestingModule } from '@nestjs/testing';
import { SettingsService } from './settings.service.js';
import { createMock } from '@golevelup/ts-jest';
import { InfluxService } from '../influx/influx.service.js';
import { PortalPagesConfigurationDto } from '../portal/dto/configuration.dto.js';
import { SchedulerService } from '../scheduler/scheduler.service.js';
import { SchedulerStatus, schedulerType, SupportedMeasurementFrequencies } from '../scheduler/dto/scheduler.dto.js';
import { ComputeCostSource } from './dto/update-settings.dto.js';
import { SettingInfluxRow } from '../influx/entities/settingsInfluxTable.entity.js';

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
    describe('partial update of the settings document', () => {
        const businessID = 'some-business-id';
        const subject = 'some-subject';
        const storedSetting = {
            _value: 'Orchard Systems',
            businessID,
            addressLine1: '12 Mill Lane',
            addressLine2: 'Unit 4',
            city: 'Cambridge',
            postalCode: 'CB1 2AB',
            supportEmail: 'billing@orchard.example',
            invoicePaymentTerm: '30',
            invoiceApproval: 'automatic',
            invoiceGeneration: 'consolidatedPerBillingCycle',
            sendInvoiceEmail: 'false',
            computeCostSource: ComputeCostSource.eks,
            pages: JSON.stringify({
                invoice: { enabled: true, text: 'Your invoices' },
                payment: { enabled: true, text: 'Pay a bill' },
                offering: {
                    enabled: true,
                    text: 'Choose a plan',
                    appearance: {
                        accent: '#1f6feb',
                        border: '#d0d7de',
                        radius: '8',
                        pricingTable: { ctaText: '#ffffff', showLogo: true },
                    },
                },
            }),
        } as unknown as SettingInfluxRow;

        beforeEach(() => {
            jest.spyOn(influxService, 'getLatestSettings').mockResolvedValue([storedSetting]);
            jest.spyOn(influxService, 'loadPoints').mockResolvedValue();
        });

        it('should keep every field the caller did not name', async () => {
            const {
                data: [setting],
            } = await service.update({ businessID, subject, postalCode: 'CB2 3CD' });

            expect(setting.postalCode).toEqual('CB2 3CD');
            expect(setting.businessName).toEqual('Orchard Systems');
            expect(setting.addressLine1).toEqual('12 Mill Lane');
            expect(setting.city).toEqual('Cambridge');
            expect(setting.supportEmail).toEqual('billing@orchard.example');
            expect(setting.invoicePaymentTerm).toEqual('30');
            expect(setting.invoiceApproval).toEqual('automatic');
            expect(setting.invoiceGeneration).toEqual('consolidatedPerBillingCycle');
            expect(setting.sendInvoiceEmail).toEqual('false');
            expect(setting.pages.invoice).toEqual({ enabled: true, text: 'Your invoices' });
        });

        it('should write a field the caller sent as an empty value', async () => {
            const {
                data: [setting],
            } = await service.update({ businessID, subject, addressLine2: '' });

            expect(setting.addressLine2).toEqual('');
            expect(setting.addressLine1).toEqual('12 Mill Lane');
        });

        it('should leave the other portal pages exactly as they were', async () => {
            const {
                data: [setting],
            } = await service.update({ businessID, subject, pages: { invoice: { text: 'Bills' } } });

            expect(setting.pages.invoice.text).toEqual('Bills');
            expect(setting.pages.invoice.enabled).toEqual(true);
            expect(setting.pages.payment).toEqual({ enabled: true, text: 'Pay a bill' });
            expect(setting.pages.offering.text).toEqual('Choose a plan');
            expect(setting.pages.offering.appearance).toEqual({
                accent: '#1f6feb',
                border: '#d0d7de',
                radius: '8',
                pricingTable: { ctaText: '#ffffff', showLogo: true },
            });
        });

        it('should leave the rest of the appearance block alone when one entry is named', async () => {
            const {
                data: [setting],
            } = await service.update({
                businessID,
                subject,
                pages: { offering: { appearance: { accent: '#000000', pricingTable: { showLogo: false } } } },
            });

            expect(setting.pages.offering.appearance).toEqual({
                accent: '#000000',
                border: '#d0d7de',
                radius: '8',
                pricingTable: { ctaText: '#ffffff', showLogo: false },
            });
            expect(setting.pages.offering.text).toEqual('Choose a plan');
            expect(setting.pages.invoice).toEqual({ enabled: true, text: 'Your invoices' });
        });

        it('should wind down the hourly compute cost collection when the source is turned off', async () => {
            await service.update({ businessID, subject, computeCostSource: ComputeCostSource.none });

            expect(schedulerService.remove).toBeCalledWith({
                businessID,
                schedulerID: `${businessID}-getAndCommitPODCost`,
            });
            expect(schedulerService.create).not.toBeCalled();
        });

        it('should not touch the collection when the source is restated', async () => {
            await service.update({ businessID, subject, computeCostSource: ComputeCostSource.eks });

            expect(schedulerService.create).not.toBeCalled();
            expect(schedulerService.remove).not.toBeCalled();
        });

        it('should not touch the collection when the source is not named', async () => {
            await service.update({ businessID, subject, city: 'Ely' });

            expect(schedulerService.create).not.toBeCalled();
            expect(schedulerService.remove).not.toBeCalled();
        });

        it('should start the hourly compute cost collection when the source is turned on', async () => {
            jest.spyOn(influxService, 'getLatestSettings').mockResolvedValue([]);

            await service.update({ businessID, subject, computeCostSource: ComputeCostSource.eks });

            expect(schedulerService.create).toBeCalledWith(
                expect.objectContaining({
                    businessID,
                    schedulerID: `${businessID}-getAndCommitPODCost`,
                    rate: SupportedMeasurementFrequencies.everyHour,
                    schedulerStatus: SchedulerStatus.live,
                    schedulerType: schedulerType.cost,
                    scheduleParameters: { costType: ComputeCostSource.eks },
                }),
            );
            expect(schedulerService.remove).not.toBeCalled();
        });
    });

    describe('updateProfile', () => {
        const businessID = 'some-business-id';
        const subject = 'some-subject';

        beforeEach(() => {
            jest.spyOn(influxService, 'getLatestSettings').mockResolvedValue([
                {
                    _value: 'Orchard Systems',
                    businessID,
                    addressLine1: '12 Mill Lane',
                    city: 'Cambridge',
                    invoiceApproval: 'automatic',
                } as unknown as SettingInfluxRow,
            ]);
            jest.spyOn(influxService, 'loadPoints').mockResolvedValue();
        });

        it('should save the profile field set over the settings document', async () => {
            const {
                message,
                data: [profile],
            } = await service.updateProfile({ businessID, subject, city: 'Ely', addressLine2: '' });

            expect(influxService.loadPoints).toBeCalledTimes(1);
            expect(message).toEqual('Setting updated successfully');
            expect(profile.city).toEqual('Ely');
            expect(profile.addressLine2).toEqual('');
            expect(profile.addressLine1).toEqual('12 Mill Lane');
            expect(profile.businessName).toEqual('Orchard Systems');
        });

        it('should keep the settings the profile screen does not show', async () => {
            const updateSpy = jest.spyOn(service, 'update');

            await service.updateProfile({ businessID, subject, city: 'Ely' });

            expect(updateSpy).toBeCalledWith({ businessID, subject, city: 'Ely' });
            const {
                data: [setting],
            } = await updateSpy.mock.results[0].value;
            expect(setting.invoiceApproval).toEqual('automatic');
            expect(setting.city).toEqual('Ely');
        });
    });
});
