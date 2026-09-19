import { describe, expect, it } from 'vitest';
import { buildIntakePayload } from '../client/src/pages/Intake';
const form = {projectName:'Synthetic Project',projectType:'repair',clientFirstName:'Synthetic',clientLastName:'Customer',clientEmail:'fixture@example.test',clientPhone:'',address:'100 Example Lane',city:'Charleston',county:'Charleston',state:'SC',zipCode:'29401',channel:'direct',serviceType:'repair',area:'100',finishLevel:'standard',condition:'fixture',notes:''};
const ID='a4700000-0000-4000-8000-000000000001';
describe('intake UI operation', () => {
  it('builds a single creation payload rather than orphan-prone separate writes', () => {
    expect(buildIntakePayload(form,ID)).toMatchObject({requestId:ID,newProject:{name:'Synthetic Project',client:{firstName:'Synthetic',lastName:'Customer',email:'fixture@example.test'}},rawPayload:{projectName:'Synthetic Project',clientName:'Synthetic Customer'}});
  });
  it('keeps scope data together with the owning project creation', () => { expect(buildIntakePayload(form,ID)).toMatchObject({channel:'direct',serviceType:'repair',area:'100',finishLevel:'standard',condition:'fixture'}); });
  it('omits blank contact fields so optional email validation works', () => { expect(buildIntakePayload({...form,clientEmail:''},ID).newProject.client.email).toBeUndefined(); });
  it('preserves one retry identifier across the same form submission', () => { expect(buildIntakePayload(form,ID)).toEqual(buildIntakePayload(form,ID)); });
});
