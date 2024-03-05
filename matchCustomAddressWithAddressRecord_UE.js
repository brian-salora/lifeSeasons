/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */

define(['N/search', 'N/record', 'N/runtime'], (search, record, runtime) => {
  /**
   * Adds hidden fields that will be used by the script as reference for post processing updates.
   * @param {*} context
   */
  function beforeLoad(context) {
    try {
      if (context.type == context.UserEventType.CREATE) {
        context.form.addField({
          id: 'custpage_serp_is_addr_overriden',
          label: 'is overriden',
          type: 'checkbox',
          displayType: 'hidden',
        });
        context.form.addField({
          id: 'custpage_serp_is_addr_set',
          label: 'addr set',
          type: 'text',
          displayType: 'hidden',
        });
      }
    } catch (err) {
      log.error({
        title: 'BEFORE_LOAD_ADD_FIELD_ERROR',
        details: JSON.stringify({
          message: err.message,
          stack: err.stack,
        }),
      });
    }
  }

  /**
   * Main script logic here
   * Sets the sales rep base on the matched addres
   * @param {*} context
   * @returns
   */
  function beforeSubmit(context) {
    try {
      const { CREATE } = context.UserEventType;
      if (![CREATE].includes(context.type)) return;

      const { newRecord: salesOrder } = context;
      const customer = salesOrder.getValue({ fieldId: 'entity' });

      const shippingAddress =
        salesOrder.getValue({
          fieldId: 'shipaddresslist',
        }) || null;
      log.debug('CUSTOMER:ADDR', { customer, shippingAddress });

      // halt execution if all fields are empty or is not custom
      if (!shippingAddress) {
        log.debug('EXECUTION_HALT', {
          message: 'Shipping address does is not custom',
          shippingAddress,
        });
        return;
      }

      const shippingSubrecord = salesOrder.getSubrecord({
        fieldId: 'shippingaddress',
      });
      if (shippingAddress != -2) {
        const salesRep = shippingSubrecord.getValue({
          fieldId: 'custrecord_ls_sales_rep',
        });
        const isTeamSellingEnabled = runtime.isFeatureInEffect({
          feature: 'TEAMSELLING',
        });
        if (!isTeamSellingEnabled) {
          salesOrder.setValue({
            fieldId: 'salesrep',
            value: salesRep,
          });
        } else {
          const lineCount = salesOrder.getLineCount({ sublistId: 'salesteam' });
          const NS_SALES_REP_INTENAL_ID = -2;
          salesOrder.setSublistValue({
            sublistId: 'salesteam',
            fieldId: 'employee',
            line: lineCount,
            value: salesRep,
          });
          salesOrder.setSublistValue({
            sublistId: 'salesteam',
            fieldId: 'salesrole',
            line: lineCount,
            value: NS_SALES_REP_INTENAL_ID,
          });
          salesOrder.setSublistValue({
            sublistId: 'salesteam',
            fieldId: 'isprimary',
            line: lineCount,
            value: true,
          });
        }
      } else {
        const address1 = shippingSubrecord.getValue({ fieldId: 'addr1' }) || '';
        const city = shippingSubrecord.getValue({ fieldId: 'city' }) || '';
        const state = shippingSubrecord.getValue({ fieldId: 'state' }) || '';

        log.debug('ADDR_SEARCH_PARAMETERS', {
          customerId: customer,
          address1,
          city,
          state,
        });

        const matchedAddressess = matchTransactionAddress({
          customerId: customer,
          address1,
          city,
          state,
        });
        log.debug('MATCHED_ADDRESSES', JSON.stringify(matchedAddressess));
        if (matchedAddressess.length > 0) {
          log.audit({
            title: `HAS_MATCH_SETTING_ADDRLIST: ${matchedAddressess[0]?.addressId}`,
          });
          salesOrder.setValue({
            fieldId: 'shipaddresslist',
            value: matchedAddressess[0]?.addressId,
          });
          salesOrder.setValue({
            fieldId: 'custpage_serp_is_addr_overriden',
            value: true,
          });
          salesOrder.setValue({
            fieldId: 'custpage_serp_is_addr_set',
            value: matchedAddressess[0]?.addressId,
          });
          log.audit({
            title: `HAS_MATCH_GET_ADDRLIST: ${salesOrder.getValue({
              fieldId: 'shipaddresslist',
            })}`,
          });
          const isTeamSellingEnabled = runtime.isFeatureInEffect({
            feature: 'TEAMSELLING',
          });
          if (!isTeamSellingEnabled) {
            salesOrder.setValue({
              fieldId: 'salesrep',
              value: matchedAddressess[0]?.salesRepId,
            });
          } else {
            const sublistId = 'salesteam';
            const lineCount = salesOrder.getLineCount({ sublistId });
            const NS_SALES_REP_INTENAL_ID = -2;
            salesOrder.setSublistValue({
              sublistId,
              fieldId: 'employee',
              line: lineCount,
              value: matchedAddressess[0]?.salesRepId,
            });
            salesOrder.setSublistValue({
              sublistId,
              fieldId: 'salesrole',
              line: lineCount,
              value: NS_SALES_REP_INTENAL_ID,
            });
            salesOrder.setSublistValue({
              sublistId: 'salesteam',
              fieldId: 'isprimary',
              line: lineCount,
              value: true,
            });
          }
        }
      }
    } catch (err) {
      log.error({
        title: `UNEXPECTED_ERROR: ${err.message}`,
        details: JSON.stringify({
          message: err.message,
          stack: err.stack,
        }),
      });
    }
  }

  /**
   * Sets the list field base on the results from beforeSubmit
   * @param {*} context
   */
  function afterSubmit(context) {
    try {
      if (context.type == context.UserEventType.CREATE) {
        const { newRecord } = context;
        log.audit(
          'script_field_values',
          JSON.stringify({
            isOverriden:
              newRecord.getValue({
                fieldId: 'custpage_serp_is_addr_overriden',
              }) || false,
            addrSet:
              newRecord.getValue({
                fieldId: 'custpage_serp_is_addr_set',
              }) || 'none',
          })
        );
        const isOverriden =
          newRecord.getValue({
            fieldId: 'custpage_serp_is_addr_overriden',
          }) == 'T' || false;

        const overrideId = newRecord.getValue({
          fieldId: 'custpage_serp_is_addr_set',
        });

        if (isOverriden && !!overrideId) {
          record.submitFields({
            type: newRecord.type,
            id: newRecord.id,
            values: {
              shipaddresslist: overrideId,
            },
          });
        }
      }
    } catch (err) {
      log.audit({
        title: 'AFTER_SUBMIT_ERROR',
        details: JSON.stringify({
          message: err.message,
          stack: err.stack,
        }),
      });
    }
  }

  /**
   * Searches for the customer addresses
   * @param {*} customerId
   * @returns
   */
  function matchTransactionAddress({ customerId, address1, city, state }) {
    const searchObj = search.load({
      id: 'customsearch_serp_customer_addresses',
    });
    if (customerId) {
      searchObj.filters.push(
        search.createFilter({
          name: 'internalid',
          operator: search.Operator.ANYOF,
          values: customerId,
        })
      );
    }

    searchObj.filters.push(
      search.createFilter({
        name: 'address1',
        join: 'address',
        operator: search.Operator.IS,
        values: address1,
      })
    );

    searchObj.filters.push(
      search.createFilter({
        name: 'city',
        join: 'address',
        operator: search.Operator.IS,
        values: city,
      })
    );

    searchObj.filters.push(
      search.createFilter({
        name: 'state',
        join: 'address',
        operator: search.Operator.IS,
        values: state,
      })
    );

    const results = searchObj.run().getRange({ start: 0, end: 1000 });
    const data = results.map((result) => ({
      internalId: Number(result.getValue({ name: 'internalid' })),
      entityId: result.getValue({ name: 'entityid' }),
      name: result.getValue({ name: 'altname' }),
      addr: result.getValue({ name: 'address', join: 'address' }),
      addressId: Number(
        result.getValue({ name: 'addressinternalid', join: 'address' })
      ),
      address1: result.getValue({ name: 'address1', join: 'address' }),
      city: result.getValue({ name: 'city', join: 'address' }),
      state: result.getValue({ name: 'statedisplayname', join: 'address' }),
      salesRepId: result.getValue({
        name: 'custrecord_ls_sales_rep',
        join: 'address',
      }),
    }));
    return data;
  }

  return { beforeLoad, beforeSubmit, afterSubmit };
});
