import { Setting } from '../client/privateClient/settings.js';
import { Customer } from '../client/publicClient/customer.js';
import { Dimension } from '../client/publicClient/dimension.js';
import { Measurement, UsageRecordInS3Measurement } from '../client/publicClient/measurement.js';
import { Offering, UsageBasedOffering } from '../client/publicClient/offering.js';
import { Service } from '../client/publicClient/service.js';
import { sleep } from './utils.js';
import expect from 'expect';
import { Scheduler } from '../client/privateClient/scheduler.js';
import { resetSettingsInput } from '../setupAndTeardown/setup.js';

/**
 * Sets the state of an account back to zero. This is useful for integration tests.
 * The order of functions is important, since there are interdependencies between the resources.
 * Additionally, each delete function checks that the resource has been deleted. By calling the corresponding get function on its client.
 *
 */
export const deleteAndResetAllResources = async () => {
    try {
        await deleteAllCustomers();
    } catch (e) {
        console.debug(e);
    }
    try {
        await deleteAllOfferings();
    } catch (e) {
        console.debug(e);
    }
    try {
        await deleteAllDimensions();
    } catch (e) {
        console.debug(e);
    }
    try {
        await deleteAllMeasurements();
    } catch (e) {
        console.debug(e);
    }

    try {
        await resetSettings();
    } catch (e) {
        console.debug(e);
    }
};

export const deleteAllOfferings = async (): Promise<void> => {
    const offerings: Offering[] = [];
    const offeringClient = new UsageBasedOffering();
    const response = await offeringClient.getAll();
    response.forEach((offeringMetadata) => {
        offerings.push(new UsageBasedOffering(offeringMetadata.offeringId));
    });

    await Promise.all(
        offerings.map(async (offering) => {
            try {
                await offering.delete();
            } catch (e) {
                console.debug(e);
            }
        })
    );
    await sleep(1000 * 2);
    expect((await offeringClient.getAll()).length).toBe(0);
};

export const deleteAllDimensions = async (): Promise<void> => {
    const dimensions: Dimension[] = [];
    const dimensionClient = new Dimension();
    const response = await dimensionClient.getAll();
    response.forEach((dimensionMetadata) => {
        dimensions.push(new Dimension(dimensionMetadata.dimensionId));
    });

    await Promise.all(
        dimensions.map(async (dimension) => {
            try {
                await dimension.delete();
            } catch (e) {
                console.debug(e);
            }
        })
    );
    await sleep(1000 * 2);
    expect((await dimensionClient.getAll()).length).toBe(0);
};

export const deleteAllMeasurements = async (): Promise<void> => {
    const measurements: Measurement[] = [];
    const measurementClient = new UsageRecordInS3Measurement();
    const response = await measurementClient.getAll();
    response.forEach((measurementMetadata) => {
        measurements.push(new UsageRecordInS3Measurement(measurementMetadata.measurementId));
    });

    await Promise.all(
        measurements.map(async (measurement) => {
            try {
                await measurement.delete();
            } catch (e) {
                console.debug(e);
            }
        })
    );
    await sleep(1000 * 2);
    expect((await measurementClient.getAll()).length).toBe(0);
};

export const deleteAllCustomers = async (): Promise<void> => {
    const customers: Customer[] = [];
    const customerClient = new Customer();
    const response = await customerClient.getAll();
    response.forEach((customerMetadata) => {
        customers.push(new Customer(customerMetadata.customerId));
    });

    await Promise.all(
        customers.map(async (customer) => {
            try {
                await customer.delete();
            } catch (e) {
                console.debug(e);
            }
        })
    );
    await sleep(1000 * 2);
    expect((await customerClient.getAll()).length).toBe(0);
};

export const resetSettings = async (): Promise<void> => {
    await Setting.resetSettings();
    await sleep(1000 * 2);
    const getSettings = (await Setting.getAll()) as Setting;
    const defaultSettings = new Setting(resetSettingsInput);
    expect(getSettings).toEqual({ ...defaultSettings, accountState: expect.anything() });
};

/**
 *
 * Ideally we should not be using this method. Schedules are managed by other resources in MeteringCo. Such as Dimensions, or Customers, or Settings etc..
 * This method is only used in the case of a bug that needs to be triaged and we want the ENV to be reset due to time limitations to fix the bug.
 */
export const deleteAllSchedules = async (): Promise<void> => {
    try {
        const response = await Scheduler.getAll();
        const scheduleIds = response.map((schedule) => schedule.id.split('#')[1]);

        await Promise.all(
            scheduleIds.map(async (id) => {
                try {
                    await Scheduler.delete(id);
                } catch (e) {
                    console.debug(e);
                }
            })
        );
        await sleep(1000 * 2);
    } catch (e) {
        console.debug(e);
    }
    try {
        await Scheduler.getAll();
    } catch (e) {
        expect(e.statusCode).toBe(404);
    }
};
