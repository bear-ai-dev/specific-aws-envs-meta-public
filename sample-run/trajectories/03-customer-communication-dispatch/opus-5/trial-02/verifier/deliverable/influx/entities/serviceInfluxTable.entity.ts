import { CreateCustomerDto } from '../../customer/dto/create-customer.dto.js';
import { OfferingPackageEntity } from '../../offering/entities/offeringPackage.entity.js';
import { ServiceEntity } from '../../services/entities/service.entity.js';
import { BaseInfluxTable } from './baseInfluxTable.entity.js';

export class ServiceInfluxRow extends BaseInfluxTable {
    /** 
     * Your unique client ID for the service, this is the customer Identifier in your system
     * @example
     * 
     'MyAwesomeSaaSClient123'
     *
     **/
    public customerId: CreateCustomerDto['customerId'];

    /**
     * The businessID associated with your account, not needed for full accounts, this is gathered during authentication
     * @example 'My Cool Corp'
     *
     **/
    public businessID: string;

    /**
     * The associated offering document which is attached to the service
     * @example 'abcd123-asf2-4444-aaaa-kashaskjh3421'
     *
     **/
    public offeringId: OfferingPackageEntity['offeringId'];

    /**
     * A unique ID for the service
     * @example 'e88595c2-abec-4a86-af34-daad942ae0c5'
     *
     **/
    public serviceId: string;

    /**
     * A unique ID for the application, customer inputed
     * @example 'e88595c2-abec-4a86-af34-daad942ae0c5'
     *
     **/
    public applicationId: string;
    /**
     * The value in the influx row is the serviceName for this case.
     * This is because the value is the only non-indexed row
     *
     **/
    public declare _value: ServiceEntity['serviceName'];

    public declare _field: string;
}
