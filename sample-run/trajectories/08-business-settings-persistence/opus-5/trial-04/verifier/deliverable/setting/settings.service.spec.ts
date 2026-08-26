import { Test, TestingModule } from '@nestjs/testing';
import { SettingsService } from './settings.service.js';
import { createMock } from '@golevelup/ts-jest';
import { InfluxService } from '../influx/influx.service.js';
import { PortalPagesConfigurationDto } from '../portal/dto/configuration.dto.js';
import { SchedulerService } from '../scheduler/scheduler.service.js';
import { ComputeCostSource } from './dto/update-settings.dto.js';
import { InvoiceApproval } from './dto/InvoiceApproval.js';
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
    describe('partial updates', () => {
        const businessID = 'some-business-id';
        const subject = 'some-subject';
        const storedSetting = {
            _value: 'Cool Corp',
            businessID,
            addressLine1: '123 Main St',
            addressLine2: 'Suite 1',
            city: 'San Francisco',
            postalCode: '94105',
            supportEmail: 'support@coolcorp.com',
            invoiceApproval: InvoiceApproval.automatic,
            pages: JSON.stringify({
                invoice: { enabled: false, text: 'My Invoices' },
                payment: { enabled: true, text: 'My Payments' },
                offering: {
                    enabled: true,
                    text: 'My Plans',
                    appearance: { background: '#000000', accent: '#111111', radius: '10' },
                },
            }),
        } as SettingInfluxRow;

        const storeSetting = (setting: Partial<SettingInfluxRow> = {}) =>
            jest.spyOn(influxService, 'getLatestSettings').mockResolvedValue([{ ...storedSetting, ...setting }]);

        it('should keep every field the caller did not send', async () => {
            storeSetting();

            const {
                data: [setting],
            } = await service.update({ businessID, subject, postalCode: '10001' });

            expect(setting.postalCode).toEqual('10001');
            expect(setting.businessName).toEqual('Cool Corp');
            expect(setting.addressLine1).toEqual('123 Main St');
            expect(setting.city).toEqual('San Francisco');
            expect(setting.supportEmail).toEqual('support@coolcorp.com');
            expect(setting.invoiceApproval).toEqual(InvoiceApproval.automatic);
            expect(setting.pages.invoice).toEqual({ enabled: false, text: 'My Invoices' });
            expect(setting.pages.offering.text).toEqual('My Plans');
        });

        it('should write a field which was sent in empty', async () => {
            storeSetting();

            const {
                data: [setting],
            } = await service.update({ businessID, subject, addressLine2: '' });

            expect(setting.addressLine2).toEqual('');
            expect(setting.addressLine1).toEqual('123 Main St');
        });

        it('should leave the other pages alone when a single page is named', async () => {
            storeSetting();

            const {
                data: [setting],
            } = await service.update({
                businessID,
                subject,
                pages: { offering: { appearance: { background: '#ffffff' } } },
            });

            expect(setting.pages.invoice).toEqual({ enabled: false, text: 'My Invoices' });
            expect(setting.pages.payment).toEqual({ enabled: true, text: 'My Payments' });
            expect(setting.pages.offering.enabled).toEqual(true);
            expect(setting.pages.offering.text).toEqual('My Plans');
            expect(setting.pages.offering.appearance).toEqual({
                background: '#ffffff',
                accent: '#111111',
                radius: '10',
            });
        });
    });

    describe('compute cost collection', () => {
        const businessID = 'some-business-id';
        const subject = 'some-subject';
        const storeComputeCostSource = (computeCostSource: ComputeCostSource) =>
            jest
                .spyOn(influxService, 'getLatestSettings')
                .mockResolvedValue([{ _value: 'Cool Corp', businessID, computeCostSource } as SettingInfluxRow]);

        it('should start the hourly collection when the source is turned on', async () => {
            storeComputeCostSource(ComputeCostSource.none);

            await service.update({ businessID, subject, computeCostSource: ComputeCostSource.eks });

            expect(schedulerService.create).toBeCalledTimes(1);
            expect(schedulerService.remove).toBeCalledTimes(0);
        });

        it('should wind the hourly collection down when the source is turned off', async () => {
            storeComputeCostSource(ComputeCostSource.eks);

            await service.update({ businessID, subject, computeCostSource: ComputeCostSource.none });

            expect(schedulerService.remove).toBeCalledTimes(1);
            expect(schedulerService.create).toBeCalledTimes(0);
        });

        it('should do neither when the stored value is simply restated', async () => {
            storeComputeCostSource(ComputeCostSource.eks);

            await service.update({ businessID, subject, computeCostSource: ComputeCostSource.eks });

            expect(schedulerService.create).toBeCalledTimes(0);
            expect(schedulerService.remove).toBeCalledTimes(0);
        });

        it('should do neither when the source is not part of the update', async () => {
            storeComputeCostSource(ComputeCostSource.eks);

            await service.update({ businessID, subject, city: 'New York' });

            expect(schedulerService.create).toBeCalledTimes(0);
            expect(schedulerService.remove).toBeCalledTimes(0);
        });
    });

    describe('updateProfile', () => {
        const businessID = 'some-business-id';
        const subject = 'some-subject';

        it('should save the profile field set over the same settings document', async () => {
            jest.spyOn(influxService, 'getLatestSettings').mockResolvedValue([
                {
                    _value: 'Cool Corp',
                    businessID,
                    addressLine1: '123 Main St',
                    addressLine2: 'Suite 1',
                    city: 'San Francisco',
                    supportEmail: 'support@coolcorp.com',
                } as SettingInfluxRow,
            ]);

            const { data, message } = await service.updateProfile({
                businessID,
                subject,
                city: 'New York',
                addressLine2: '',
            });
            const [profile] = data;

            expect(influxService.loadPoints).toBeCalledTimes(1);
            expect(message).toBeDefined();
            expect(profile.city).toEqual('New York');
            expect(profile.addressLine2).toEqual('');
            expect(profile.addressLine1).toEqual('123 Main St');
            expect(profile.businessName).toEqual('Cool Corp');
            expect(profile.supportEmail).toEqual('support@coolcorp.com');
        });
    });
});
