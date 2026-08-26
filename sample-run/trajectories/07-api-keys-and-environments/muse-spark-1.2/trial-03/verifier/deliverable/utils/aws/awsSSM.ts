import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';

export const getRegionNameFromCode = async (region) => {
    const client = new SSMClient({});
    const regionURL = `/aws/service/global-infrastructure/regions/${region}/longName`;
    const { Parameter } = await client.send(new GetParameterCommand({ Name: regionURL }));
    return Parameter?.Value;
};
