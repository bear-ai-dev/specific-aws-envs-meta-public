/**
 *
 *
 * The base elements which generally should be present on all responses from Influx, these are the required iternal values
 * Not present are any of the tag keys or tag values set on the table, those are specifically set in the other child classes, which extend this one.
 *
 * Note:
 * There can be cases where values like _field and _value are missing due to how the query was constructed, specifically if the keep function was used, or during a join.
 * @url https://docs.influxdata.com/flux/v0.x/stdlib/universe/keep/
 */

export class BaseInfluxTable {
    /**
     *
     * The measurement for a table
     * @example "meteringco_container_cpu_usage_seconds_total"
     * @example "DimensionConfig"
     */
    public _measurement: string;
    /**
     *
     * An RFC 3339 date time value in a string format
     * @example "2019-08-18T00:06:00Z"
     */
    public _time: string;

    /**
     *
     * The value associated with the field in the table, is the only not indexed part of the data set
     * @example 1
     * @example true
     */
    public _value: string | number | boolean;

    /**
     *
     * The field key associated with its corresponding value, typically I've just defaulted it to "value"
     * @example "value"
     */
    public _field: string | number;
}
