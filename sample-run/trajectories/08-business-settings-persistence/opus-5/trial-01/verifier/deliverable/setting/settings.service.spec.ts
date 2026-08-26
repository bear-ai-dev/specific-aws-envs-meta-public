import { Test, TestingModule } from '@nestjs/testing';
import { SettingsService } from './settings.service.js';
import { createMock } from '@golevelup/ts-jest';
import { InfluxService } from '../influx/influx.service.js';
import { PortalPagesConfigurationDto } from '../portal/dto/configuration.dto.js';
import { ComputeCostSource, InvoiceGeneration, SendInvoiceEmail } from './dto/update-settings.dto.js';
import { InvoiceApproval } from './dto/InvoiceApproval.js';
import { SchedulerService } from '../scheduler/scheduler.service.js';
import { PodCostEntity } from '../cost/entities/podCost.entity.js';
import { InvoicePaymentTerm } from '../invoice/entities/InvoicePaymentTerm.js';

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
});

describe('SettingService partial updates', () => {
    let service: SettingsService;
    let influxService: InfluxService;
    let schedulerService: SchedulerService;
    const businessID = 'some-business-id';
    const subject = 'some-subject';

    const storedRow = {
        _value: 'Stored Business',
        businessID,
        addressLine1: '1 Stored Street',
        addressLine2: 'Suite 2',
        city: 'Stored City',
        state: 'CA',
        country: 'USA',
        postalCode: '94188',
        supportEmail: 'support@stored.com',
        invoicePaymentTerm: InvoicePaymentTerm.net30,
        invoiceApproval: InvoiceApproval.automatic,
        invoiceGeneration: InvoiceGeneration.consolidatedPerBillingCycle,
        sendInvoiceEmail: SendInvoiceEmail.doNotSend,
        computeCostSource: ComputeCostSource.none,
        pages: JSON.stringify({
            invoice: { enabled: true, text: 'Stored Invoice' },
            payment: { enabled: true, text: 'Stored Payment' },
            offering: {
                enabled: true,
                text: 'Stored Plans',
                appearance: { background: '#ffffff', accent: '#000000', radius: '4' },
            },
        }),
    };

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [SettingsService],
        })
            .useMocker(createMock)
            .compile();

        service = module.get(SettingsService);
        influxService = module.get(InfluxService);
        schedulerService = module.get(SchedulerService);
        jest.spyOn(influxService, 'loadPoints').mockResolvedValue();
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    const mockStored = (row: Record<string, unknown> = storedRow) =>
        jest.spyOn(influxService, 'getLatestSettings').mockResolvedValue([row]);

    it('should keep the fields the caller did not send', async () => {
        mockStored();

        const { data } = await service.update({ businessID, subject, postalCode: '10001' });

        expect(data[0].postalCode).toEqual('10001');
        expect(data[0].businessName).toEqual('Stored Business');
        expect(data[0].addressLine1).toEqual('1 Stored Street');
        expect(data[0].invoiceApproval).toEqual(InvoiceApproval.automatic);
        expect(data[0].invoiceGeneration).toEqual(InvoiceGeneration.consolidatedPerBillingCycle);
        expect(data[0].sendInvoiceEmail).toEqual(SendInvoiceEmail.doNotSend);
        expect(data[0].invoicePaymentTerm).toEqual(InvoicePaymentTerm.net30);
        expect(data[0].supportEmail).toEqual('support@stored.com');
        expect(data[0].pages.invoice.text).toEqual('Stored Invoice');
        expect(data[0].pages.payment.text).toEqual('Stored Payment');
        expect(data[0].pages.offering.text).toEqual('Stored Plans');
    });

    it('should write a field the caller sent even when it is empty', async () => {
        mockStored();

        const { data } = await service.update({ businessID, subject, addressLine2: '' });

        expect(data[0].addressLine2).toEqual('');
        expect(data[0].addressLine1).toEqual('1 Stored Street');
    });

    it('should leave the pages the caller did not name alone', async () => {
        mockStored();

        const { data } = await service.update({
            businessID,
            subject,
            pages: { invoice: { text: 'New Invoice Wording' } },
        });

        expect(data[0].pages.invoice).toEqual({ enabled: true, text: 'New Invoice Wording' });
        expect(data[0].pages.payment).toEqual({ enabled: true, text: 'Stored Payment' });
        expect(data[0].pages.offering.text).toEqual('Stored Plans');
        expect(data[0].pages.offering.appearance).toEqual({
            background: '#ffffff',
            accent: '#000000',
            radius: '4',
        });
    });

    it('should leave the rest of an appearance block alone', async () => {
        mockStored();

        const { data } = await service.update({
            businessID,
            subject,
            pages: { offering: { appearance: { background: '#123456' } } },
        });

        expect(data[0].pages.offering).toEqual({
            enabled: true,
            text: 'Stored Plans',
            appearance: { background: '#123456', accent: '#000000', radius: '4' },
        });
        expect(data[0].pages.invoice.text).toEqual('Stored Invoice');
    });

    it('should start the hourly compute cost gathering when it is turned on', async () => {
        mockStored();
        const enroll = jest.spyOn(PodCostEntity, 'enroll').mockResolvedValue();
        const unenroll = jest.spyOn(PodCostEntity, 'unenroll').mockResolvedValue();

        await service.update({ businessID, subject, computeCostSource: ComputeCostSource.eks });

        expect(enroll).toHaveBeenCalledTimes(1);
        expect(enroll).toHaveBeenCalledWith(schedulerService, { businessID, subject });
        expect(unenroll).not.toHaveBeenCalled();
        enroll.mockRestore();
        unenroll.mockRestore();
    });

    it('should wind the hourly compute cost gathering down when it is turned off', async () => {
        mockStored({ ...storedRow, computeCostSource: ComputeCostSource.eks });
        const enroll = jest.spyOn(PodCostEntity, 'enroll').mockResolvedValue();
        const unenroll = jest.spyOn(PodCostEntity, 'unenroll').mockResolvedValue();

        await service.update({ businessID, subject, computeCostSource: ComputeCostSource.none });

        expect(unenroll).toHaveBeenCalledTimes(1);
        expect(unenroll).toHaveBeenCalledWith(schedulerService, { businessID, subject });
        expect(enroll).not.toHaveBeenCalled();
        enroll.mockRestore();
        unenroll.mockRestore();
    });

    it('should do nothing to the compute cost gathering when the setting is restated', async () => {
        mockStored({ ...storedRow, computeCostSource: ComputeCostSource.eks });
        const enroll = jest.spyOn(PodCostEntity, 'enroll').mockResolvedValue();
        const unenroll = jest.spyOn(PodCostEntity, 'unenroll').mockResolvedValue();

        await service.update({ businessID, subject, computeCostSource: ComputeCostSource.eks });

        expect(enroll).not.toHaveBeenCalled();
        expect(unenroll).not.toHaveBeenCalled();
        enroll.mockRestore();
        unenroll.mockRestore();
    });

    it('should do nothing to the compute cost gathering when the setting is untouched', async () => {
        mockStored({ ...storedRow, computeCostSource: ComputeCostSource.eks });
        const enroll = jest.spyOn(PodCostEntity, 'enroll').mockResolvedValue();
        const unenroll = jest.spyOn(PodCostEntity, 'unenroll').mockResolvedValue();

        await service.update({ businessID, subject, city: 'Somewhere Else' });

        expect(enroll).not.toHaveBeenCalled();
        expect(unenroll).not.toHaveBeenCalled();
        enroll.mockRestore();
        unenroll.mockRestore();
    });

    describe('updateProfile', () => {
        it('should save the profile screen fields over the same document', async () => {
            mockStored();

            const result = await service.updateProfile({
                businessID,
                subject,
                businessName: 'New Trading Name',
                addressLine2: '',
            });

            expect(result.data[0].businessName).toEqual('New Trading Name');
            expect(result.data[0].addressLine2).toEqual('');
            expect(result.data[0].city).toEqual('Stored City');
            expect(result.data[0].supportEmail).toEqual('support@stored.com');
            expect(influxService.loadPoints).toHaveBeenCalledTimes(1);
        });

        it('should not disturb the settings the profile screen does not show', async () => {
            mockStored();
            const loadPoints = jest.spyOn(influxService, 'loadPoints');

            await service.updateProfile({ businessID, subject, postalCode: '10001' });

            const [latestSetting] = await Promise.resolve([await service.findLatestSetting({ businessID })]);
            expect(latestSetting.invoiceApproval).toEqual(InvoiceApproval.automatic);
            expect(loadPoints).toHaveBeenCalled();
        });
    });
});
