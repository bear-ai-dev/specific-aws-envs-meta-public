import { Test, TestingModule } from '@nestjs/testing';
import { SettingsService } from './settings.service.js';
import { createMock } from '@golevelup/ts-jest';
import { InfluxService } from '../influx/influx.service.js';
import { PortalPagesConfigurationDto } from '../portal/dto/configuration.dto.js';
import { SchedulerService } from '../scheduler/scheduler.service.js';
import { ComputeCostSource } from './dto/update-settings.dto.js';
import { InvoiceApproval } from './dto/InvoiceApproval.js';

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
        const storedSetting = {
            businessID,
            _value: 'Cool Corp',
            city: 'San Francisco',
            postalCode: '94105',
            addressLine2: 'Suite 1',
            invoiceApproval: InvoiceApproval.automatic,
            pages: JSON.stringify({
                invoice: { enabled: false, text: 'My Bills' },
                offering: { enabled: true, text: 'Plans!', appearance: { background: '#000000', radius: '10' } },
            }),
        };

        it('should keep the stored values of the fields that were not sent in', async () => {
            jest.spyOn(influxService, 'loadPoints').mockResolvedValueOnce();
            jest.spyOn(influxService, 'getLatestSettings').mockResolvedValueOnce([storedSetting]);

            const {
                data: [setting],
            } = await service.update({ businessID, subject, postalCode: '10001', addressLine2: '' });

            expect(setting.postalCode).toEqual('10001');
            // A field that was sent in is written even when it is empty
            expect(setting.addressLine2).toEqual('');
            expect(setting.businessName).toEqual('Cool Corp');
            expect(setting.city).toEqual('San Francisco');
            expect(setting.invoiceApproval).toEqual(InvoiceApproval.automatic);
            expect(setting.pages.invoice).toEqual({ enabled: false, text: 'My Bills' });
        });

        it('should merge the nested page configuration instead of replacing it', async () => {
            jest.spyOn(influxService, 'loadPoints').mockResolvedValueOnce();
            jest.spyOn(influxService, 'getLatestSettings').mockResolvedValueOnce([storedSetting]);

            const {
                data: [setting],
            } = await service.update({
                businessID,
                subject,
                pages: { offering: { appearance: { radius: '20' } } },
            });

            expect(setting.pages.invoice).toEqual({ enabled: false, text: 'My Bills' });
            expect(setting.pages.offering.text).toEqual('Plans!');
            expect(setting.pages.offering.appearance).toEqual({ background: '#000000', radius: '20' });
        });

        it('should start the compute cost collection when the compute cost source is turned on', async () => {
            jest.spyOn(influxService, 'loadPoints').mockResolvedValueOnce();
            jest.spyOn(influxService, 'getLatestSettings').mockResolvedValueOnce([storedSetting]);

            await service.update({ businessID, subject, computeCostSource: ComputeCostSource.eks });

            expect(schedulerService.create).toBeCalledTimes(1);
            expect(schedulerService.remove).not.toBeCalled();
        });

        it('should stop the compute cost collection when the compute cost source is turned off', async () => {
            jest.spyOn(influxService, 'loadPoints').mockResolvedValueOnce();
            jest.spyOn(influxService, 'getLatestSettings').mockResolvedValueOnce([
                { ...storedSetting, computeCostSource: ComputeCostSource.eks },
            ]);

            await service.update({ businessID, subject, computeCostSource: ComputeCostSource.none });

            expect(schedulerService.remove).toBeCalledTimes(1);
            expect(schedulerService.create).not.toBeCalled();
        });

        it('should leave the compute cost collection alone when the compute cost source did not change', async () => {
            jest.spyOn(influxService, 'loadPoints').mockResolvedValueOnce();
            jest.spyOn(influxService, 'getLatestSettings').mockResolvedValueOnce([
                { ...storedSetting, computeCostSource: ComputeCostSource.eks },
            ]);

            await service.update({ businessID, subject, computeCostSource: ComputeCostSource.eks });

            expect(schedulerService.create).not.toBeCalled();
            expect(schedulerService.remove).not.toBeCalled();
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

    describe('updateProfile', () => {
        const businessID = 'some-business-id';
        const subject = 'some-subject';

        it('should update the profile fields over the settings document', async () => {
            jest.spyOn(influxService, 'loadPoints').mockResolvedValueOnce();
            jest.spyOn(influxService, 'getLatestSettings').mockResolvedValueOnce([
                {
                    businessID,
                    _value: 'Cool Corp',
                    city: 'San Francisco',
                    postalCode: '94105',
                    invoiceApproval: InvoiceApproval.automatic,
                },
            ]);

            const {
                message,
                data: [profile],
            } = await service.updateProfile({ businessID, subject, city: 'Denver' });

            expect(message).toEqual('Business profile updated successfully');
            expect(profile.city).toEqual('Denver');
            expect(profile.businessName).toEqual('Cool Corp');
            expect(profile.postalCode).toEqual('94105');
            expect(influxService.loadPoints).toBeCalledTimes(1);
        });
    });
});
