import { SettingsEntity, StripeConnected } from '../../../src/setting/entities/settings.entity';
import { productionBusinessID } from './user';

export const simpleSetting = {
    businessName: 'Test Business',
    addressLine1: '123 Main St',
    addressLine2: 'Suite 1',
    city: 'San Francisco',
    state: 'CA',
    country: 'USA',
    postalCode: '94105',
    vatId: '123456789',
    logoUrl: 'https://www.google.com/images/branding/googlelogo/1x/googlelogo_color_272x92dp.png',
};

const simpleSettingsWithStripe = {
    stripeConnected: StripeConnected.connected,
    stripeAccountId: 'fakeStripeAccountId',
    businessID: productionBusinessID,
    _field: 'businessName',
    _value: 'Cool Corp',
    _time: new Date().toISOString(),
    _measurement: SettingsEntity._measurement,
};

export const settingsGenerator = () => simpleSettingsWithStripe;
