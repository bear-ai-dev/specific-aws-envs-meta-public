import { Point } from '@influxdata/influxdb-client';
import { InfluxService } from '../../influx/influx.service';
import { CustomerGroupInfluxRow } from '../../influx/entities/CustomerGroupInflux.entity';
import { ApiHideProperty, ApiProperty } from '@nestjs/swagger';
import { BillParent } from './BillParent';

export class ChildRowEntity {
    public static _measurement = 'childRow';
    /**
     * The childId is the unique identifier for the child row
     * <br><br>
     * Example: `"9ffc73f3-eece-4a48-bfcd-c2c91153e97f"`
     */
    @ApiProperty()
    public childId: string;
    /**
     * The parentId is the unique identifier for the parent row
     * <br><br>
     * Example: `"e962aefe-6134-4f28-8967-a11cfe7f0bf2"`
     */
    @ApiProperty()
    public parentId?: string;
    @ApiHideProperty()
    public businessID: string;
    /**
     * This determines if the parent should be billed for invoices of the child. Defaults to `separate`.
     * <br><br>
     * Example: `"aggregated"`
     */
    @ApiProperty()
    public billParent?: BillParent;

    constructor({ childId, parentId, businessID, billParent }: ChildRowEntity) {
        this.childId = childId;
        if (parentId) {
            this.parentId = parentId;
        }
        this.businessID = businessID;
        this.billParent = billParent ? billParent : BillParent.separate;
    }

    static transformer(childRow: ChildRowEntity, influxService: InfluxService): Array<Point> {
        const childRowPoint = influxService.getPoint(ChildRowEntity._measurement);
        childRowPoint.tag('childId', childRow.childId);
        if (childRow?.parentId) {
            childRowPoint.tag('parentId', childRow.parentId);
        }
        childRowPoint.tag('businessID', childRow.businessID);
        childRowPoint.tag('billParent', childRow.billParent);
        childRowPoint.stringField('childId', childRow.childId);

        return [childRowPoint];
    }

    static dbModelToEntity(dbModel: ChildRowEntity): ChildRowEntity {
        const { childId, parentId, businessID, billParent } = dbModel;
        return new ChildRowEntity({
            childId,
            parentId,
            businessID,
            billParent,
        });
    }
}
export class CustomerGroupEntity {
    public static _measurement = 'customerGroup';
    public groupId: string;
    public groupName?: string;
    public groupDescription?: string;
    public businessID: string;
    public parentId: string;
    public metadata?: Record<string, string>;

    constructor({ groupId, groupName, groupDescription, parentId, businessID, metadata }: CustomerGroupEntity) {
        this.groupId = groupId;
        if (groupName) {
            this.groupName = groupName;
        }
        if (groupDescription) {
            this.groupDescription = groupDescription;
        }
        this.parentId = parentId;
        this.businessID = businessID;
        if (metadata) {
            this.metadata = metadata;
        }
    }

    static transformer(customerEntity: CustomerGroupEntity, influxService: InfluxService): Array<Point> {
        const customerEntityPoint = influxService.getPoint(CustomerGroupEntity._measurement);
        if (customerEntity.groupDescription) {
            customerEntityPoint.stringField('groupDescription', customerEntity.groupDescription);
        }
        if (customerEntity.metadata) {
            customerEntityPoint.tag('metadata', JSON.stringify(customerEntity.metadata));
        }
        if (customerEntity?.groupName) {
            customerEntityPoint.tag('groupName', customerEntity.groupName);
        }
        customerEntityPoint.tag('groupId', customerEntity.groupId);
        customerEntityPoint.tag('parentId', customerEntity.parentId);
        customerEntityPoint.tag('businessID', customerEntity.businessID);
        return [customerEntityPoint];
    }

    static dbModelToEntity(dbModel: CustomerGroupInfluxRow) {
        const { _value, groupName, parentId, businessID, metadata, groupId } = dbModel;

        return new CustomerGroupEntity({
            groupDescription: _value,
            groupId,
            groupName,
            parentId,
            metadata: metadata ? JSON.parse(metadata) : undefined,
            businessID,
        });
    }
}
