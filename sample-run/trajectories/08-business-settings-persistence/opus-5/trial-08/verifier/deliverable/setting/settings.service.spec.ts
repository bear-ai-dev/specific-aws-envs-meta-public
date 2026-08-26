import { Test, TestingModule } from '@nestjs/testing';
import { SettingsService } from './settings.service.js';
import { createMock } from '@golevelup/ts-jest';
import { InfluxService } from '../influx/influx.service.js';
import { PortalPagesConfigurationDto } from '../portal/dto/configuration.dto.js';
import { SchedulerService } from '../scheduler/scheduler.service.js';
import { ComputeCostSource, InvoiceGeneration, SendInvoiceEmail } from './dto/update-settings.dto.js';
import { InvoiceApproval } from './dto/InvoiceApproval.js';
import { SettingInfluxRow } from '../influx/entities/settingsInfluxTable.entity.js';

const storedSettingRow = (overrides: Partial<SettingInfluxRow> = {}): SettingInfluxRow =>
    ({
        _value: 'Cool Corp',
        businessID: 'some-business-id',
        addressLine1: '12 Mill Lane',
        addressLine2: 'Unit 4',
        city: 'Cambridge',
        state: 'Cambridgeshire',
        country: 'GB',
        postalCode: 'CB1 1AA',
        supportEmail: 'billing@cool.co',
        invoicePaymentTerm: '30',
        invoiceApproval: InvoiceApproval.automatic,
        invoiceGeneration: InvoiceGeneration.consolidatedPerBillingCycle,
        sendInvoiceEmail: SendInvoiceEmail.doNotSend,
        computeCostSource: ComputeCostSource.none,
        pages: JSON.stringify({
            invoice: { enabled: true, text: 'Your invoices' },
            payment: { enabled: true, text: 'Pay a bill' },
            offering: {
                enabled: true,
                text: 'Choose a plan',
                appearance: { accent: '#1f6feb', border: '#d0d7de', radius: '8px' },
            },
        }),
        ...overrides,
    }) as SettingInfluxRow;

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

    describe('update only writes the fields it was given', () => {
        const businessID = 'some-business-id';

        beforeEach(() => {
            jest.spyOn(influxService, 'loadPoints').mockResolvedValue();
        });

        it('keeps every field that was not sent and writes the ones that were, blank included', async () => {
            jest.spyOn(influxService, 'getLatestSettings').mockResolvedValue([storedSettingRow()]);

            const {
                data: [setting],
            } = await service.update({ businessID, postalCode: 'CB2 2BB', addressLine2: '' });

            expect(setting.postalCode).toEqual('CB2 2BB');
            expect(setting.addressLine2).toEqual('');
            expect(setting.businessName).toEqual('Cool Corp');
            expect(setting.addressLine1).toEqual('12 Mill Lane');
            expect(setting.city).toEqual('Cambridge');
            expect(setting.state).toEqual('Cambridgeshire');
            expect(setting.country).toEqual('GB');
            expect(setting.supportEmail).toEqual('billing@cool.co');
            expect(setting.invoicePaymentTerm).toEqual('30');
            expect(setting.invoiceApproval).toEqual(InvoiceApproval.automatic);
            expect(setting.invoiceGeneration).toEqual(InvoiceGeneration.consolidatedPerBillingCycle);
            expect(setting.sendInvoiceEmail).toEqual(SendInvoiceEmail.doNotSend);
            expect(setting.pages).toEqual({
                invoice: { enabled: true, text: 'Your invoices' },
                payment: { enabled: true, text: 'Pay a bill' },
                offering: {
                    enabled: true,
                    text: 'Choose a plan',
                    appearance: { accent: '#1f6feb', border: '#d0d7de', radius: '8px' },
                },
            });
        });

        it('leaves the pages that were not named, and the appearance entries that were not named, alone', async () => {
            jest.spyOn(influxService, 'getLatestSettings').mockResolvedValue([storedSettingRow()]);

            const {
                data: [setting],
            } = await service.update({
                businessID,
                pages: { offering: { appearance: { accent: '#000000' } } },
            });

            expect(setting.pages.invoice).toEqual({ enabled: true, text: 'Your invoices' });
            expect(setting.pages.payment).toEqual({ enabled: true, text: 'Pay a bill' });
            expect(setting.pages.offering).toEqual({
                enabled: true,
                text: 'Choose a plan',
                appearance: { accent: '#000000', border: '#d0d7de', radius: '8px' },
            });
        });

        it('falls back to the defaults for fields that were never stored', async () => {
            jest.spyOn(influxService, 'getLatestSettings').mockResolvedValue([]);

            const {
                data: [setting],
            } = await service.update({ businessID, city: 'Bristol' });

            expect(setting.city).toEqual('Bristol');
            expect(setting.invoiceApproval).toEqual(InvoiceApproval.manual);
            expect(setting.invoiceGeneration).toEqual(InvoiceGeneration.perTransaction);
            expect(setting.sendInvoiceEmail).toEqual(SendInvoiceEmail.send);
            expect(setting.pages.invoice).toEqual({ enabled: true, text: 'Invoice' });
        });

        it('starts the hourly compute cost collection when the cluster source is turned on', async () => {
            jest.spyOn(influxService, 'getLatestSettings').mockResolvedValue([storedSettingRow()]);

            await service.update({ businessID, subject: 'some-subject', computeCostSource: ComputeCostSource.eks });

            expect(schedulerService.create).toBeCalledTimes(1);
            expect(schedulerService.remove).not.toBeCalled();
        });

        it('winds the hourly compute cost collection down when the cluster source is turned off', async () => {
            jest.spyOn(influxService, 'getLatestSettings').mockResolvedValue([
                storedSettingRow({ computeCostSource: ComputeCostSource.eks }),
            ]);

            await service.update({ businessID, computeCostSource: ComputeCostSource.none });

            expect(schedulerService.remove).toBeCalledTimes(1);
            expect(schedulerService.create).not.toBeCalled();
        });

        it('does neither when the stored compute cost source is only restated, or not sent at all', async () => {
            jest.spyOn(influxService, 'getLatestSettings').mockResolvedValue([
                storedSettingRow({ computeCostSource: ComputeCostSource.eks }),
            ]);

            await service.update({ businessID, computeCostSource: ComputeCostSource.eks });
            await service.update({ businessID, city: 'Bristol' });

            expect(schedulerService.create).not.toBeCalled();
            expect(schedulerService.remove).not.toBeCalled();
        });
    });

    describe('updateProfile', () => {
        const businessID = 'some-business-id';

        beforeEach(() => {
            jest.spyOn(influxService, 'loadPoints').mockResolvedValue();
            jest.spyOn(influxService, 'getLatestSettings').mockResolvedValue([storedSettingRow()]);
        });

        it('saves the profile screen field set over the settings document', async () => {
            const {
                data: [profile],
            } = await service.updateProfile({ businessID, subject: 'some-subject', city: 'Bristol', state: '' });

            expect(influxService.loadPoints).toBeCalledTimes(1);
            expect(profile.city).toEqual('Bristol');
            expect(profile.state).toEqual('');
            expect(profile.businessName).toEqual('Cool Corp');
            expect(profile.addressLine1).toEqual('12 Mill Lane');
            expect(profile.postalCode).toEqual('CB1 1AA');
            expect(profile.supportEmail).toEqual('billing@cool.co');
            expect(profile.sendInvoiceEmail).toEqual(SendInvoiceEmail.doNotSend);
        });

        it('does not disturb anything outside of the profile field set', async () => {
            await service.updateProfile({ businessID, city: 'Bristol' });
            const {
                data: [setting],
            } = await service.update({ businessID });

            expect(setting.invoiceApproval).toEqual(InvoiceApproval.automatic);
            expect(setting.pages.offering.text).toEqual('Choose a plan');
        });
    });
});
