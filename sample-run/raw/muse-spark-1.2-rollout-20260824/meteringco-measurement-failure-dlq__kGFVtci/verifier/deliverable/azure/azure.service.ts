import { Injectable } from '@nestjs/common';
import { CreateAzureDto } from './dto/create-azure.dto.js';
import { UpdateAzureDto } from './dto/update-azure.dto.js';
import { ClientSecretCredential } from '@azure/identity';
import { ComputeManagementClient, Disk } from '@azure/arm-compute';
import { Job } from 'bull';
import { SchedulerEntity } from '../scheduler/entities/scheduler.entity.js';
import { StandardMeasurementEntity } from '../measurement-config/entities/standardMeasurement.entity.js';
import { UsageEntity } from '../usage/entities/usage.entity.js';
import { ArrayGroupBy } from '../utils/shared/utils.js';

// TODO get from measurement
const clientId = 'e7fa40de-cf0c-4a01-8983-02b6452d1e5d';
const clientSecret = 'MYn8Q~mRpjOIz2rNYlvbXObY95_rpyik1SoLpcHo';
const tenantId = '070b0cd1-28a1-4044-8037-1a1e4914bac0';
// TODO get from measurement
const region = 'eastus';
const subscriptionId = 'd6a0f42e-b781-4c68-9a28-8b86a3b1b397';

const groupByTags = ArrayGroupBy(['meteringcoDimensionId', 'meteringcoCustomerId']);
const resourceGroupRegex = /\/subscriptions\/[a-f\d-]+\/resourceGroups\/([a-zA-Z\d_-]+)\//;

@Injectable()
export class AzureService {
    async disk({ data: { rate, scheduleParameters, businessID, subject } }, dimensionId: string) {
        const credential = new ClientSecretCredential(
            tenantId, // The tenant ID in Azure Active Directory
            clientId, // The app registration client Id in the AAD tenant
            clientSecret, // The app registration secret for the registered application
        );
        const computeClient = new ComputeManagementClient(credential, subscriptionId);
        const diskList = [];

        for await (const item of computeClient.disks.list()) {
            diskList.push(item);
        }
        const taggedDisks = diskList.filter((disk) => {
            const tags = disk.tags || {};
            if (!tags.meteringcoDimensionId || tags.meteringcoDimensionId.trim() === '') {
                return false;
            } else if (!tags.meteringcoCustomerId || tags.meteringcoCustomerId.trim() === '') {
                return false;
            } else if (tags.meteringcoDimensionId === dimensionId) {
                // if qualifies, flattening tag by making them properties of disk in order to group by later
                Object.keys(tags).forEach((key) => {
                    disk[key] = tags[key];
                });
                return true;
            } else {
                return false;
            }
        });
        const groupedDisks = groupByTags(taggedDisks);
        const res = [];
        Object.entries(groupedDisks).forEach(([groupKey, disks]) => {
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            const diskSizeTotal = disks.reduce((acc, disk) => acc + disk.diskSizeGB, 0.0);
            const metadata = Object.entries(disks[0]).reduce((acc, [metadataKey, metadataValue]) => {
                acc[metadataKey] = typeof metadataValue === 'string' ? metadataValue : JSON.stringify(metadataValue);
                return acc;
            }, {});
            const entity = new StandardMeasurementEntity({
                businessID,
                dimensionId,
                metadata,
                recordValue: diskSizeTotal,
                customerId: disks[0].meteringcoCustomerId,
                _measurement: UsageEntity._measurement,
            });
            res.push(entity);
            StandardMeasurementEntity.publish(entity);
        });

        return res;
    }

    // async vm({ data: { rate, scheduleParameters, businessID, subject } }: Job<SchedulerEntity>) { // TODO
    async vm({ data: { rate, scheduleParameters, businessID, subject } }, dimensionId: string) {
        // const { dimensionId } = scheduleParameters; // TODO

        const credential = new ClientSecretCredential(
            tenantId, // The tenant ID in Azure Active Directory
            clientId, // The app registration client Id in the AAD tenant
            clientSecret, // The app registration secret for the registered application
        );
        const computeClient = new ComputeManagementClient(credential, subscriptionId);
        const vmList = [];

        for await (const item of computeClient.virtualMachines.listByLocation(region)) {
            vmList.push(item);
        }

        const taggedVms = vmList.filter((vm) => {
            const tags = vm.tags || {};
            if (!tags.meteringcoDimensionId || tags.meteringcoDimensionId.trim() === '') {
                return false;
            } else if (!tags.meteringcoCustomerId || tags.meteringcoCustomerId.trim() === '') {
                return false;
            }
            return tags.meteringcoDimensionId === dimensionId;
        });

        const qualifiedVms = [];
        for (const vm of taggedVms) {
            // Extract the resource group ID from the input string
            const match = vm.id.match(resourceGroupRegex);
            const resourceGroupId = match[1];
            const vmInfo = await computeClient.virtualMachines.get(resourceGroupId, vm.name, {
                expand: 'instanceView',
            });
            const statusList = vmInfo.instanceView.statuses;
            if (
                statusList.find((status) => status.code === 'PowerState/running') &&
                statusList.find((status) => status.code === 'ProvisioningState/succeeded')
            ) {
                Object.keys(vmInfo.tags).forEach((key) => {
                    vmInfo[key] = vmInfo.tags[key];
                });
                delete vmInfo.tags;
                qualifiedVms.push(vmInfo);
            }
        }
        const groupedVms = groupByTags(qualifiedVms);
        const res = []; // TODO remove
        Object.keys(groupedVms).forEach((key) => {
            const runningTimeTotal = groupedVms[key].length * 0.05;
            // for now, only take the metadata of the first vm
            const metadata = Object.keys(groupedVms[key][0]).reduce((acc, metadataKey) => {
                acc[metadataKey] =
                    typeof groupedVms[key][0][metadataKey] === 'string'
                        ? groupedVms[key][0][metadataKey]
                        : JSON.stringify(groupedVms[key][0][metadataKey]);
                return acc;
            }, {});
            const entity = new StandardMeasurementEntity({
                businessID,
                dimensionId,
                metadata,
                recordValue: runningTimeTotal,
                customerId: groupedVms[key][0].meteringcoCustomerId,
                _measurement: UsageEntity._measurement,
            });
            res.push(entity);
            StandardMeasurementEntity.publish(entity);
        });
        return res;
    }
}
