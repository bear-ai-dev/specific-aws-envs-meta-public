import {
    forwardRef,
    Inject,
    Injectable,
    Logger,
    NotFoundException,
    ForbiddenException,
    BadRequestException,
} from '@nestjs/common';
import { CreateServiceDto, CreateServiceResponse } from './dto/createService.dto.js';
import { InfluxService } from '../influx/influx.service.js';
import { ServiceEntity } from './entities/service.entity.js';
import { ReadServiceDTO, ReadServiceResponse, ReadServiceResponseData } from './dto/readService.dto.js';
import { DeleteServiceDTO } from './dto/deleteService.dto.js';
import { v4 } from 'uuid';
import { UsageService } from '../usage/usage.service.js';
import { OfferingService } from '../offering/offering.service.js';
import { CustomerService } from '../customer/customer.service.js';
import { UpdateServiceDto } from './dto/updateService.dto.js';

@Injectable()
export class ServicesService {
    private static readonly logger = new Logger(ServiceEntity.name);

    constructor(
        @Inject(forwardRef(() => InfluxService)) readonly InfluxService: InfluxService,
        @Inject(forwardRef(() => OfferingService)) readonly offeringService: OfferingService,
        @Inject(forwardRef(() => UsageService)) readonly usageService: UsageService,
        @Inject(forwardRef(() => CustomerService)) readonly customerService: CustomerService,
    ) {}
    async create({
        customerId,
        offeringId,
        businessID,
        applicationId,
        ...rest
    }: CreateServiceDto): Promise<CreateServiceResponse> {
        // Check for improper offerings or customers
        await Promise.all([
            await this.customerService.findOne({ businessID, customerId }),
            await this.offeringService.findOne({ businessID, offeringId }),
        ]);
        const { loadPoints } = this.InfluxService;
        if (applicationId) {
            // Determine if the applicationId is already in use
            await this.determineIfApplicationIdIsOnServices({ businessID, applicationId });
        }
        const serviceId = v4();

        const serviceEntityModel = new ServiceEntity({
            ...rest,
            customerId,
            offeringId,
            applicationId,
            businessID,
            serviceId,
        });
        const dbModel = ServiceEntity.transformer(serviceEntityModel, this.InfluxService);
        await loadPoints(`${process.env.STAGE}-config`, process.env.INFLUX_ORG, dbModel);
        ServicesService.logger.debug('Commited a new Service to DB', { serviceEntityModel });
        return { message: 'Created a new Service', serviceId: serviceEntityModel.serviceId };
    }

    private async determineIfApplicationIdIsOnServices({ applicationId, businessID, updateServiceId = '' }) {
        const { findApplicationId } = this.InfluxService;
        const rows = await findApplicationId({ applicationId, businessID });
        if (rows.length) {
            const services = await Promise.all(
                rows.map(async ({ serviceId }) => {
                    const res = await this.findOne({ businessID, serviceId });
                    return res;
                }),
            );
            services.forEach(({ data: [{ applicationId: foundId, serviceId }] }) => {
                if (foundId === applicationId) {
                    if (updateServiceId && updateServiceId === serviceId) {
                        // Skip in cases where the ID passed in is the same as the one found IE: Puts should be Idempotent
                        return;
                    } else {
                        throw new BadRequestException(
                            `applicationId: ${applicationId} already in use with service. serviceId: ${serviceId}`,
                        );
                    }
                }
            });
        }
    }
    async findAll({ businessID }): Promise<ReadServiceResponse> {
        const serviceConfigs = await this.InfluxService.getAllElementsFromTableForBusiness(
            ServiceEntity._measurement,
            businessID,
            'serviceId',
        );

        if (serviceConfigs.length === 0) {
            return { data: [], message: 'No Services found' };
        }
        const entites = ReadServiceDTO.getServiceEntityDTO(serviceConfigs);
        const errors = [];
        const responseData = await Promise.all(
            entites.map(async (entity) => {
                try {
                    const { offeringId, customerId, businessID: entityBusinessID, ...rest } = entity;
                    const {
                        data: [offering],
                    } = await this.offeringService.findOne({ businessID, offeringId });
                    const {
                        data: [customer],
                    } = await this.customerService.findOne({ businessID, customerId });
                    return { offering, customer, ...rest };
                } catch (error) {
                    ServicesService.logger.error(error);
                    errors.push(error);
                }
            }),
        );
        const returnedServices = responseData.filter((e) => e);
        if (returnedServices.length > 0) {
            return { data: returnedServices, message: 'Found Services' };
        } else {
            return { data: [], message: 'No Services found' };
        }
    }

    async findAllServiceAndApplicationIds({
        businessID,
    }): Promise<{ data: Array<{ serviceId: string; applicationId: string }> }> {
        const serviceConfigs = await this.InfluxService.getAllElementsFromTableForBusiness(
            ServiceEntity._measurement,
            businessID,
            'serviceId',
        );
        if (serviceConfigs.length === 0) {
            throw new NotFoundException('No Services found for business');
        }
        const entites = ReadServiceDTO.getServiceEntityDTO(serviceConfigs);
        return { data: entites.map((e) => ({ serviceId: e.serviceId, applicationId: e.applicationId })) };
    }
    async findOne({ businessID, serviceId }: ReadServiceDTO): Promise<ReadServiceResponse> {
        ServicesService.logger.log('Getting information for a service', { businessID, serviceId });
        const serviceConfig = await this.InfluxService.getSingleService(
            ServiceEntity._measurement,
            businessID,
            serviceId,
        );
        if (serviceConfig.length === 0) {
            throw new NotFoundException(`No Service with id: ${serviceId} found for business`);
        }
        const [entity] = ReadServiceDTO.getServiceEntityDTO(serviceConfig);
        const { offeringId, customerId, businessID: entityBusinessID, ...rest } = entity;
        const {
            data: [offering],
        } = await this.offeringService.findOne({ businessID, offeringId: entity.offeringId });
        const {
            data: [customer],
        } = await this.customerService.findOne({ businessID, customerId });
        ServicesService.logger.debug('Returned Configuration', { serviceConfig });
        return { data: [{ offering, customer, ...rest }], message: 'Found Service' };
    }

    async findAllServicesWithofferingId({
        businessID,
        offeringId,
    }: ReadServiceDTO): Promise<{ data: CreateServiceDto[]; message: string }> {
        const serviceConfig = await this.InfluxService.getAllServicesByOfferingId({ offeringId, businessID });
        return {
            data: ReadServiceDTO.getServiceEntityDTO(serviceConfig),
            message: 'Found Services',
        };
    }
    async findAllServicesWithCustomerId({
        businessID,
        customerId,
    }: {
        businessID: string;
        customerId: string;
    }): Promise<{ data: ReadServiceResponseData[]; message: string }> {
        const serviceConfig = await this.InfluxService.getAllServicesWithCustomerId(
            ServiceEntity._measurement,
            businessID,
            customerId,
        );
        if (serviceConfig.length) {
            const results = ReadServiceDTO.getServiceEntityDTO(serviceConfig);
            const completeResults = await Promise.all(
                results.map(async ({ serviceId }) => {
                    const { data } = await this.findOne({ serviceId, businessID });
                    return data[0];
                }),
            );
            return {
                data: completeResults,
                message: 'Found Services',
            };
        } else {
            return {
                data: [],
                message: 'No Services found',
            };
        }
    }
    async update({
        serviceId,
        businessID,
        customerId: updatedCustomerId,
        offeringId: updatedOfferingId,
        applicationId,
        ...updatedFields
    }: UpdateServiceDto): Promise<CreateServiceResponse> {
        ServicesService.logger.log('Updating a Service');
        const {
            data: [{ offering, customer, ...rest }],
        } = await this.findOne({ serviceId, businessID });
        const { loadPoints } = this.InfluxService;
        let offeringId = offering.offeringId;
        let customerId = customer.customerId;

        if (applicationId) {
            // Determine if the applicationId is already in use
            await this.determineIfApplicationIdIsOnServices({ businessID, applicationId, updateServiceId: serviceId });
        }
        if (updatedOfferingId && updatedOfferingId != offeringId) {
            const {
                data: [updatedOffering],
            } = await this.offeringService.findOne({ businessID, offeringId: updatedOfferingId });
            if (updatedOffering?.offeringVisibility === 'private') {
                const serviceConfig = await this.InfluxService.getAllServicesWithofferingId(
                    ServiceEntity._measurement,
                    businessID,
                    updatedOffering.offeringId,
                );
                if (serviceConfig.length != 0) {
                    throw new ForbiddenException(
                        `A private offering can only be associated with a single service: ${updatedOffering.offeringId} has been used.`,
                    );
                }
            }
            offeringId = updatedOffering.offeringId;
        }
        if (updatedCustomerId && updatedCustomerId != customerId) {
            const {
                data: [updateCustomer],
            } = await this.customerService.findOne({ businessID, customerId: updatedCustomerId });
            customerId = updateCustomer.customerId;
        }
        const entity = new ServiceEntity({
            offeringId,
            customerId,
            ...rest,
            applicationId,
            ...updatedFields,
            businessID,
            serviceId,
        });
        const dbModel = ServiceEntity.transformer(entity, this.InfluxService);
        await loadPoints(`${process.env.STAGE}-config`, process.env.INFLUX_ORG, dbModel);
        return { message: 'Loaded Service Document', serviceId: entity.serviceId };
    }
    async remove({ serviceId, businessID }: DeleteServiceDTO): Promise<{ message: string }> {
        await this.InfluxService.dropService(
            `${process.env.STAGE}-config`,
            process.env.INFLUX_ORG,
            businessID,
            serviceId,
        );
        return { message: `Removed ${serviceId}` };
    }
}
