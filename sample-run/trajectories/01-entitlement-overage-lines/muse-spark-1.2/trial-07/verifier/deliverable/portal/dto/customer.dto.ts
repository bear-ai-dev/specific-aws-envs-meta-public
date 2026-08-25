import { BasicResponseDTO } from '../../basicResponseDTO.js';
import { ReadCustomerResponseData } from '../../customer/entities/customer.entity.js';
import { PickType } from '@nestjs/swagger';
import { ReadDimensionResponseData } from '../../dimensions/dto/create-dimension.dto.js';
import { paymentChannel } from '../../customer/dto/create-customer.dto.js';

class Dimension extends PickType(ReadDimensionResponseData, [
    'dimensionId',
    'dimensionName',
    'consumptionUnit',
    'usageIncrement',
    'usageEntitlement',
    'overageAllowed',
]) {}

class CustomerOffering {
    public offeringName: string;
    public dimensions: Array<Dimension>;
}

class CustomerBillingData extends PickType(ReadCustomerResponseData, [
    'customerName',
    'email',
    'address',
    'currency',
    'freeTrialEndDate',
    'creditBalance',
    'invoices',
    'taxExempt',
    'stripeAccountReady',
]) {
    public offering?: CustomerOffering | CustomerOffering[];
    public paymentChannel?: paymentChannel;
}
export class CustomerBillingResponse extends BasicResponseDTO {
    data: CustomerBillingData[];

    static from(customerData: ReadCustomerResponseData): CustomerBillingResponse {
        if (customerData?.offering) {
            if (Array.isArray(customerData?.offering)) {
                return {
                    message: 'Found customer billing information',
                    data: [
                        {
                            customerName: customerData.customerName,
                            email: customerData.email,
                            address: customerData.address,
                            currency: customerData.currency,
                            freeTrialEndDate: customerData.freeTrialEndDate,
                            creditBalance: customerData.creditBalance,
                            invoices: customerData.invoices,
                            taxExempt: customerData.taxExempt,
                            stripeAccountReady: customerData.stripeAccountReady,
                            paymentChannel: customerData?.paymentChannel,
                            offering: customerData?.offering.map((offering) => ({
                                offeringName: offering.offeringName,
                                dimensions: offering.dimensions.map((dimension) => ({
                                    dimensionId: dimension.dimensionId,
                                    dimensionName: dimension.dimensionName,
                                    consumptionUnit: dimension.consumptionUnit,
                                    usageIncrement: dimension.usageIncrement,
                                    usageEntitlement: dimension.usageEntitlement,
                                    overageAllowed: dimension.overageAllowed,
                                    paymentSchedule: dimension?.paymentSchedule,
                                })),
                            })),
                        },
                    ],
                };
            } else {
                return {
                    message: 'Found customer billing information',
                    data: [
                        {
                            customerName: customerData.customerName,
                            email: customerData.email,
                            address: customerData.address,
                            currency: customerData.currency,
                            freeTrialEndDate: customerData.freeTrialEndDate,
                            creditBalance: customerData.creditBalance,
                            invoices: customerData.invoices,
                            taxExempt: customerData.taxExempt,
                            stripeAccountReady: customerData.stripeAccountReady,
                            paymentChannel: customerData?.paymentChannel,
                            offering: {
                                dimensions: customerData.offering.dimensions.map((dimension) => ({
                                    dimensionId: dimension.dimensionId,
                                    dimensionName: dimension.dimensionName,
                                    consumptionUnit: dimension.consumptionUnit,
                                    usageIncrement: dimension.usageIncrement,
                                    usageEntitlement: dimension.usageEntitlement,
                                    overageAllowed: dimension.overageAllowed,
                                    paymentSchedule: dimension?.paymentSchedule,
                                })),
                                offeringName: customerData.offering.offeringName,
                            },
                        },
                    ],
                };
            }
        } else {
            return {
                message: 'Found customer billing information',
                data: [
                    {
                        customerName: customerData.customerName,
                        email: customerData.email,
                        address: customerData.address,
                        currency: customerData.currency,
                        freeTrialEndDate: customerData.freeTrialEndDate,
                        creditBalance: customerData.creditBalance,
                        invoices: customerData.invoices,
                        taxExempt: customerData.taxExempt,
                        stripeAccountReady: customerData.stripeAccountReady,
                        paymentChannel: customerData?.paymentChannel,
                    },
                ],
            };
        }
    }
}
