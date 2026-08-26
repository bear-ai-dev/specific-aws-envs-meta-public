import { Test, TestingModule } from '@nestjs/testing';
import { SettingsService } from './settings.service.js';
import { createMock } from '@golevelup/ts-jest';
import { InfluxService } from '../influx/influx.service.js';
import { PortalPagesConfigurationDto } from '../portal/dto/configuration.dto.js';
import { SchedulerService } from '../scheduler/scheduler.service.js';
import { ComputeCostSource, InvoiceGeneration, SendInvoiceEmail } from './dto/update-settings.dto.js';
import { InvoiceApproval } from './dto/InvoiceApproval.js';
import { PodCostEntity } from '../cost/entities/podCost.entity.js';

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
        const storedPages = {
            invoice: { enabled: true, text: 'Stored Invoice' },
            payment: { enabled: true, text: 'Stored Payment' },
            offering: {
                enabled: true,
                text: 'Stored Plans',
                appearance: { background: '#000000', accent: '#ffffff', radius: '4' },
            },
        };
        const storedSetting = {
            _value: 'Stored Business',
            businessID,
            addressLine1: '1 Stored Street',
            addressLine2: 'Suite 5',
            city: 'Austin',
            state: 'TX',
            country: 'USA',
            postalCode: '11111',
            supportEmail: 'help@stored.business',
            invoicePaymentTerm: '30',
            invoiceApproval: InvoiceApproval.automatic,
            invoiceGeneration: InvoiceGeneration.consolidatedPerBillingCycle,
            sendInvoiceEmail: SendInvoiceEmail.doNotSend,
            computeCostSource: ComputeCostSource.eks,
            pages: JSON.stringify(storedPages),
        };

        beforeEach(() => {
            jest.spyOn(influxService, 'loadPoints').mockResolvedValue();
            jest.spyOn(influxService, 'getLatestSettings').mockResolvedValue([storedSetting]);
        });

        it('should only write the fields that were sent, and keep everything else as stored', async () => {
            const {
                data: [setting],
            } = await service.update({ businessID, postalCode: '22222' });

            expect(setting.postalCode).toEqual('22222');
            expect(setting.businessName).toEqual('Stored Business');
            expect(setting.addressLine1).toEqual('1 Stored Street');
            expect(setting.addressLine2).toEqual('Suite 5');
            expect(setting.city).toEqual('Austin');
            expect(setting.supportEmail).toEqual('help@stored.business');
            expect(setting.invoicePaymentTerm).toEqual('30');
            expect(setting.invoiceApproval).toEqual(InvoiceApproval.automatic);
            expect(setting.invoiceGeneration).toEqual(InvoiceGeneration.consolidatedPerBillingCycle);
            expect(setting.sendInvoiceEmail).toEqual(SendInvoiceEmail.doNotSend);
            expect(setting.pages).toEqual(storedPages);
        });

        it('should write a field which was sent empty', async () => {
            const {
                data: [setting],
            } = await service.update({ businessID, addressLine2: '' });

            expect(setting.addressLine2).toEqual('');
            expect(setting.addressLine1).toEqual('1 Stored Street');
            expect(setting.postalCode).toEqual('11111');
        });

        it('should leave the pages which were not sent exactly as they were', async () => {
            const {
                data: [setting],
            } = await service.update({ businessID, pages: { invoice: { text: 'Bills' } } });

            expect(setting.pages).toEqual({
                ...storedPages,
                invoice: { enabled: true, text: 'Bills' },
            });
        });

        it('should remove a field which was sent as null, leaving its neighbours alone', async () => {
            const {
                data: [setting],
            } = await service.update({
                businessID,
                pages: { offering: { appearance: { accent: null } } },
            } as never);

            expect(setting.pages).toEqual({
                ...storedPages,
                offering: {
                    ...storedPages.offering,
                    appearance: { background: '#000000', radius: '4' },
                },
            });
        });

        it('should leave the rest of an appearance block alone when one entry is sent', async () => {
            const {
                data: [setting],
            } = await service.update({
                businessID,
                pages: { offering: { appearance: { background: '#123456' } } },
            });

            expect(setting.pages).toEqual({
                ...storedPages,
                offering: {
                    ...storedPages.offering,
                    appearance: { background: '#123456', accent: '#ffffff', radius: '4' },
                },
            });
        });

        it('should start the hourly compute cost collection when the source is turned on', async () => {
            jest.spyOn(influxService, 'getLatestSettings').mockResolvedValue([
                { ...storedSetting, computeCostSource: ComputeCostSource.none },
            ]);
            const enroll = jest.spyOn(PodCostEntity, 'enroll');

            await service.update({ businessID, subject: 'some-subject', computeCostSource: ComputeCostSource.eks });

            expect(enroll).toBeCalledWith(schedulerService, { businessID, subject: 'some-subject' });
            expect(schedulerService.create).toBeCalledWith(
                expect.objectContaining({
                    businessID,
                    schedulerID: PodCostEntity.createScheduleID({ businessID }),
                    scheduleParameters: { costType: ComputeCostSource.eks },
                }),
            );
        });

        it('should wind the hourly compute cost collection down when the source is turned off', async () => {
            await service.update({ businessID, computeCostSource: ComputeCostSource.none });

            expect(schedulerService.remove).toBeCalledWith({
                businessID,
                schedulerID: PodCostEntity.createScheduleID({ businessID }),
            });
            expect(schedulerService.create).not.toBeCalled();
        });

        it('should do neither when the compute cost source is restated', async () => {
            await service.update({ businessID, computeCostSource: ComputeCostSource.eks });

            expect(schedulerService.create).not.toBeCalled();
            expect(schedulerService.remove).not.toBeCalled();
        });

        it('should do neither for a save which does not mention the compute cost source', async () => {
            await service.update({ businessID, city: 'Dallas' });

            expect(schedulerService.create).not.toBeCalled();
            expect(schedulerService.remove).not.toBeCalled();
        });

        it('should still save the settings when the compute cost collection cannot be scheduled', async () => {
            jest.spyOn(schedulerService, 'remove').mockRejectedValueOnce(new Error('no schedule'));

            const result = await service.update({ businessID, computeCostSource: ComputeCostSource.none });

            expect(influxService.loadPoints).toBeCalledTimes(1);
            expect(result.message).toEqual('Setting updated successfully');
        });
    });

    describe('updateProfile', () => {
        const businessID = 'some-business-id';

        it('should update the profile fields over the same document, leaving everything else alone', async () => {
            jest.spyOn(influxService, 'loadPoints').mockResolvedValue();
            jest.spyOn(influxService, 'getLatestSettings').mockResolvedValue([
                {
                    _value: 'Stored Business',
                    businessID,
                    addressLine1: '1 Stored Street',
                    addressLine2: 'Suite 5',
                    postalCode: '11111',
                    supportEmail: 'help@stored.business',
                    invoiceApproval: InvoiceApproval.automatic,
                },
            ]);

            const {
                data: [profile],
            } = await service.updateProfile({ businessID, city: 'Dallas', addressLine2: '' });

            expect(influxService.loadPoints).toBeCalledTimes(1);
            expect(profile).toEqual(
                expect.objectContaining({
                    businessName: 'Stored Business',
                    addressLine1: '1 Stored Street',
                    addressLine2: '',
                    city: 'Dallas',
                    postalCode: '11111',
                    supportEmail: 'help@stored.business',
                }),
            );
        });
    });
});
