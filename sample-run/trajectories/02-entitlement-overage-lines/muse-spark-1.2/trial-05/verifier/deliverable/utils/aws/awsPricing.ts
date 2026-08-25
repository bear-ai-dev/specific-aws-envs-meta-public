// Just run npm i @aws-sdk/client-pricing --save-dev
// I tested the below commands with Node Version: 14.19.2 on PopOS Linux
import { PricingClient, GetProductsCommand, GetProductsResponse } from '@aws-sdk/client-pricing';

export const awsPriceLookup = async (filters, serviceCode): Promise<GetProductsResponse['PriceList']> => {
    try {
        const pricingClient = new PricingClient({ region: 'us-east-1' });

        let next;
        const priceList = [];
        do {
            const params = {
                Filters: filters,
                FormatVersion: 'aws_v1',
                NextToken: null,
                ServiceCode: serviceCode,
            };
            const command = new GetProductsCommand(params);
            const { NextToken, PriceList } = await pricingClient.send(command);
            priceList.push(PriceList);

            next = NextToken;
        } while (next);
        return priceList.flat();
    } catch (err) {
        console.log('Error', err);
    }
};
