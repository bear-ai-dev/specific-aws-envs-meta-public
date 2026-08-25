import { BadRequestException, Inject, Injectable, NotFoundException, forwardRef } from '@nestjs/common';
import { CreateChildRowDto, CreateCustomergroupDto } from './dto/createCustomerGroup.dto';
import { UpdateCustomergroupDto } from './dto/updateCustomerGroup.dto';
import { ChildRowEntity, CustomerGroupEntity } from './entities/customergroup.entity';
import { randomUUID } from 'crypto';
import { InfluxService } from '../influx/influx.service';
import { BasicResponseDTO } from '../basicResponseDTO';
import {
    ReadChildRowResponse,
    ReadCustomerGroupDto,
    ReadCustomerGroupResponse,
    ReadCustomerGroupResponseData,
} from './dto/readCustomerGroup.dto';
import { LedgerService } from '../ledger/ledger.service';
import { LedgerType } from '../ledger/dto/ledgerType';
import { ReadChildRowResponseData } from './dto/ReadChildRowResponseData';

@Injectable()
export class CustomerGroupService {
    constructor(
        @Inject(forwardRef(() => InfluxService)) readonly influxService: InfluxService,
        @Inject(forwardRef(() => LedgerService)) readonly ledgerService: LedgerService,
    ) {}
    async createGroup(createCustomergroupDto: CreateCustomergroupDto): Promise<BasicResponseDTO & { groupId: string }> {
        const groupId = createCustomergroupDto?.groupId ? createCustomergroupDto.groupId : randomUUID();
        const entity = new CustomerGroupEntity({ ...createCustomergroupDto, groupId });
        const points = CustomerGroupEntity.transformer(entity, this.influxService);
        await this.influxService.loadPoints(`${process.env.STAGE}-config`, process.env.INFLUX_ORG, points);
        return { message: 'Added Customer Group', groupId };
    }

    async findAllGroups(readCustomerGroupDto: ReadCustomerGroupDto) {
        const { businessID } = readCustomerGroupDto;
        const topRowOfLedger = await this.ledgerService.findLedgerByType({
            startDate: new Date('1970-01-01').toISOString(),
            endDate: new Date().toISOString(),
            businessID,
            type: LedgerType.CUSTOMERGROUP,
            groupBy: ['parentId'],
            uniqueFilters: ['parentId'],
        });
        const entity = CustomerGroupEntity.dbModelToEntity(topRowOfLedger[0]);
        return {
            message: 'Customer Group Found',
            data: [new ReadCustomerGroupResponseData(entity)],
        };
    }

    async findOneGroup(readCustomerGroupDto: ReadCustomerGroupDto): Promise<ReadCustomerGroupResponse> {
        const { businessID, parentId } = readCustomerGroupDto;
        const topRowOfLedger = await this.ledgerService.findLedgerByType({
            startDate: new Date('1970-01-01').toISOString(),
            endDate: new Date().toISOString(),
            businessID,
            type: LedgerType.CUSTOMERGROUP,
            filters: {
                parentId,
            },
            groupBy: ['parentId'],
            uniqueFilters: ['parentId'],
        });
        if (topRowOfLedger && topRowOfLedger?.data.length > 0) {
            const entity = topRowOfLedger.data[0] as CustomerGroupEntity;
            return {
                message: 'Customer Group Found',
                data: [new ReadCustomerGroupResponseData(entity)],
            };
        } else {
            throw new NotFoundException(`Group with id ${parentId} not found`);
        }
    }

    async updateGroup(updateCustomergroupDto: UpdateCustomergroupDto): Promise<BasicResponseDTO> {
        const { businessID, parentId } = updateCustomergroupDto;
        const readGroupRes = await this.findOneGroup({ businessID, parentId });
        if (readGroupRes) {
            const existingGroup = readGroupRes.data[0];
            const entity = new CustomerGroupEntity({ ...existingGroup, ...updateCustomergroupDto });
            const points = CustomerGroupEntity.transformer(entity, this.influxService);
            await this.influxService.loadPoints(`${process.env.STAGE}-config`, process.env.INFLUX_ORG, points);
            return { message: 'Updated Customer Group' };
        } else {
            throw new BadRequestException(`Group with parentId: ${parentId} not found`);
        }
    }
    async validateNoCircularDependency({ parentId, newChildId, businessID }) {
        const res = await this.findAllChildRows({ businessID });
        const childRows = res.data;
        const parentMap = childRows.reduce((acc, childRow) => {
            if (!acc[childRow.parentId]) {
                acc[childRow.parentId] = [];
            }
            acc[childRow.parentId].push(childRow.childId);
            return acc;
        }, {});
        const visited = {};
        const stack = [];
        stack.push(newChildId);
        visited[newChildId] = true;
        while (stack.length > 0) {
            const currentParent = stack.pop();
            const children = parentMap[currentParent];
            if (children) {
                for (const child of children) {
                    if (child === parentId) {
                        return false;
                    }
                    if (!visited[child]) {
                        stack.push(child);
                        visited[child] = true;
                    }
                }
            }
        }
        return true;
    }

    async createChildRow({ childId, businessID, parentId, billParent }: CreateChildRowDto) {
        const circValidation = await this.validateNoCircularDependency({ parentId, newChildId: childId, businessID });
        if (circValidation) {
            const entity = new ChildRowEntity({ childId, businessID, parentId, billParent });
            const points = ChildRowEntity.transformer(entity, this.influxService);
            await this.influxService.loadPoints(`${process.env.STAGE}-config`, process.env.INFLUX_ORG, points);
            return {
                message: 'Added Child Row',
                data: [],
            };
        } else {
            throw new BadRequestException(
                `circular dependency detected for childId ${childId} to parentId ${parentId}`,
            );
        }
    }
    async findAllChildRows({ businessID }): Promise<ReadChildRowResponse> {
        const topRowOfLedger = await this.ledgerService.findLedgerByType({
            startDate: new Date('1970-01-01').toISOString(),
            endDate: new Date().toISOString(),
            businessID,
            type: LedgerType.CHILDROW,
            groupBy: ['childId'],
            uniqueFilters: ['childId'],
        });
        if (topRowOfLedger && topRowOfLedger?.data.length > 0) {
            return {
                message: 'Child Rows Found',
                data: topRowOfLedger.data.map((row) => new ReadChildRowResponseData(row as ChildRowEntity)),
            };
        } else {
            return {
                message: 'No Child Rows Found',
                data: [],
            };
        }
    }
    async findOneChildRow({ childId, businessID }): Promise<ReadChildRowResponse> {
        const topRowOfLedger = await this.ledgerService.findLedgerByType({
            startDate: new Date('1970-01-01').toISOString(),
            endDate: new Date().toISOString(),
            businessID,
            type: LedgerType.CHILDROW,
            filters: {
                childId,
            },
            groupBy: ['childId'],
            uniqueFilters: ['childId'],
        });
        if (topRowOfLedger && topRowOfLedger?.data.length > 0) {
            const entity = topRowOfLedger.data[0] as ChildRowEntity;
            return {
                message: 'Child Row Found',
                data: [entity],
            };
        } else {
            return {
                message: 'Child Row Not Found',
                data: [new ChildRowEntity({ childId, businessID })],
            };
        }
    }
    async findAllChildRowsForParent({ parentId, businessID }): Promise<ReadChildRowResponse> {
        const topRowOfLedger = await this.ledgerService.findLedgerByType({
            startDate: new Date('1970-01-01').toISOString(),
            endDate: new Date().toISOString(),
            businessID,
            type: LedgerType.CHILDROW,
            filters: {
                parentId,
            },
            groupBy: ['parentId'],
            uniqueFilters: ['parentId'],
        });
        if (topRowOfLedger && topRowOfLedger?.data.length > 0) {
            return {
                message: 'Child Rows Found',
                data: topRowOfLedger.data.map((row) => new ReadChildRowResponseData(row as ChildRowEntity)),
            };
        } else {
            return {
                message: 'No Child Rows Found',
                data: [],
            };
        }
    }

    async changeParentForChildRow({
        parentId,
        childId,
        businessID,
        billParent,
    }: CreateChildRowDto): Promise<BasicResponseDTO> {
        const circValidation = await this.validateNoCircularDependency({ parentId, newChildId: childId, businessID });
        if (circValidation) {
            const entity = new ChildRowEntity({ childId, businessID, parentId, billParent });
            const points = ChildRowEntity.transformer(entity, this.influxService);
            await this.influxService.loadPoints(`${process.env.STAGE}-config`, process.env.INFLUX_ORG, points);
            return {
                message: 'Updated Child Row',
            };
        } else {
            throw new BadRequestException(
                `circular dependency detected for childId ${childId} to parentId ${parentId}`,
            );
        }
    }
    async removeChildRowFromParent({ childId, parentId, businessID }): Promise<BasicResponseDTO> {
        const res = await this.findAllChildRowsForParent({ parentId, businessID });
        if (res.data.length === 0) {
            throw new NotFoundException(`No child rows found for parent ${parentId}`);
        }
        if (res?.data && !res.data.find(({ childId: foundChildId }) => foundChildId === childId)) {
            throw new NotFoundException(`Child row with childId ${childId} not found for parent ${parentId}`);
        }
        const entity = new ChildRowEntity({ childId, businessID, parentId: null });
        const points = ChildRowEntity.transformer(entity, this.influxService);
        await this.influxService.loadPoints(`${process.env.STAGE}-config`, process.env.INFLUX_ORG, points);

        return {
            message: 'Removed Child Row',
        };
    }
}
