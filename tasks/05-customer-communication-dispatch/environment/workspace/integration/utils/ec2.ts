import {CreateTagsCommand, DescribeInstancesCommand, EC2Client, Tag} from "@aws-sdk/client-ec2";
import {BadRequestException} from "@nestjs/common";


export const getInstanceWithFilters = async (region, filters = []): Promise<any> => {
    try {
        const ec2Client = new EC2Client({ region});
        let instances = [];
        let next;
        do {
            const response = await ec2Client.send(new DescribeInstancesCommand({ NextToken: next, Filters: filters }));
            next = response?.NextToken;
            const { Reservations } = response;
            Reservations.forEach((reservation) => {
                const { Instances } = reservation;
                instances = instances.concat(Instances);
            });
        } while (next);
        return instances;
    } catch (err) {
        console.log('Error', err);
        throw new Error(err);
    }
};

export const updateInstanceTags = async (region, instanceIds: string[] = [], tags: Tag[]) => {
    try {
        const ec2Client = new EC2Client({ region });
        const response = await ec2Client.send(new CreateTagsCommand({ Resources: instanceIds, Tags: tags }));
        return response;
    } catch (err) {
        console.log('Error', err);
        throw new Error(err);
    }
}