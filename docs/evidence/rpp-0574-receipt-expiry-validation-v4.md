# RPP-0574 receipt expiry validation variant 4

Date: 2026-05-31

Status: local generated support evidence only. Final release remains **NO-GO**.

## Scope

- Expired, stale, and blank receipt-expiry evidence fails before any generated
  dry-run receipt can reach accepted mutation work.
- Apply-side stale receipt refusal and live-source drift refusal keep mutation
  work at zero in the generated support flow.
- The accepted generated support path records live-source revalidation before
  mutation executor entry and before the first mutation event.
- No live endpoint, production credential, remote tunnel, external network
  dependency, raw request body, raw session, raw file path, or raw journal row is
  recorded in this artifact.

## Hash-only support envelope

```json
{
  "schemaVersion": 1,
  "sliceHash": "45413aa78a689a5c1f3f4a6f9aed5713e60bddc0adcd632909ffb2c0cc7dcec9",
  "proofClassHash": "45dfea2bff6aeae637d469518898e9e3b1ef77fe08ba379c85d77fe47490d4da",
  "evidenceScopeHash": "7b1cde3262a65f72980647669cb8de7e0b74f19ed2fe11b20dc4a0447fdc604d",
  "releaseStatusHash": "71643de8a49065550b0c08cec4e9842d289f4bae8ec9a7386feb037188ac9e68",
  "sourceUrlHash": "d30a576c0318716717366ab932e3d7dfbc4009a5bc10176403b60892912f070e",
  "userLoginHash": "7f5edcf9050e6218c1b9601ddc7b95656f7cc854f3bdd2e7df4c6def66381f53",
  "sessionIdHash": "0a5ae086a8910cb8a40b41838b23cb010b461fa4035cebbc9a3e0ae0d8b90d0e",
  "acceptedReceiptHash": "276d16fceb874640c2669997bc1a185f0cdfab9ba084dd78afa179b364db8fe4",
  "planHash": "c589ff0c141cf0ec2ab01dd3f615d1173cdb0f1ba873b5b59d809f259c2b140f",
  "mutationSetHash": "430c1e6c44919f0280a8e69f6e951944620e8e434f1c9f343cea95a36f79e046",
  "preconditionSetHash": "7df84bdee423e6ce99a5d81f7f46db1b7857f30458fd9af87d6362898436e05c",
  "activeClaimKeyHash": "24491dadf083b75ede011260af0b06b1ab39991497126f9f01748c343999f8b9",
  "eventOrderHash": "a38112655a0166b1fcc5ed9b449ca98a172e2fc2508fcbb572c56ba43065d4b4",
  "acceptedRequestOrderHash": "5459ea57c214cb47097c53535dc9f578add4633715b2a79a7c73324f50f597be",
  "liveSourceHash": "b90cb761db295393887a5ec6d558ca0a862575424a09250464c56f271405660e",
  "liveSourceSnapshotHash": "86ec2819f78b6443d3ed7ce08d93027a4f279d507e5dc81c766844f44bb6ae3a",
  "liveSourceUrlHash": "d30a576c0318716717366ab932e3d7dfbc4009a5bc10176403b60892912f070e",
  "negativeCoverageHash": "ce4298cadcd424fd3f28fcfcb59658f07a7feb6b3587d4a454ff821bf6f91810",
  "phaseHash": "96134e3e886b4933db347950c8e71c3a099c3cd97d695156b5068beef7e2acaf",
  "checkedAgainstHash": "e3ca671fc36c5ccee2c993fa2c57851f7129c4ebb86aebb8a9b0091270016119",
  "beforeFirstMutation": true,
  "rawValuesIncluded": false
}
```

## Negative case hashes

```json
[
  {
    "caseHash": "4fd80cd71dacaf87c2263524e6c5bc7c3a36c16aca11e5caedad0e4a855726de",
    "receiptHash": "610a5fd14b840e43c0dc7c93a04912afc28f5d491726f0bf784645520240d54c",
    "observedHash": "b81c3f63c7092bf6ebe35fa3be346c46c601f51f0c4542277b43a3cbb4f8df4f",
    "requestOrderHash": "cbe9a4919a56a6b610901f5f23660be4095c9d91cdf0dd260775d1f11ec2a7dc",
    "verdictHash": "76248138724076c0df1580656c90db3e61f8e1b8f18884529d755a2c96288df9",
    "mutationWorkHash": "140bedbf9c3f6d56a9846d2ba7088798683f4da0c248231336e6a05679e4fdfe"
  },
  {
    "caseHash": "e55651609e659f25e19e303f0e05e5405afb35e29bd261c1db2920d1ab93e875",
    "receiptHash": "bac85fa23210eae980d92b3f4d0069277ae88d97ba3a3531be431be77b4cf332",
    "observedHash": "1c5441a63eaa4ee6472cf20fa69e43fb67a60eed1e03f6e364623bdb02623dd0",
    "requestOrderHash": "cbe9a4919a56a6b610901f5f23660be4095c9d91cdf0dd260775d1f11ec2a7dc",
    "verdictHash": "76248138724076c0df1580656c90db3e61f8e1b8f18884529d755a2c96288df9",
    "mutationWorkHash": "140bedbf9c3f6d56a9846d2ba7088798683f4da0c248231336e6a05679e4fdfe"
  },
  {
    "caseHash": "f2d16d94c63a98cc5b062f8a75b261ee54494fe1f092798cf2aaf2661bd233c4",
    "receiptHash": "f6cd7d678adaf728c1a032cefd48a3b77c60ec6013cbe6eaa2771b00b9f0d5b5",
    "observedHash": "fcfbda43870068b10b78ea4771bffe998ba6fccb0a61a50fd16e5576f2e70079",
    "requestOrderHash": "cbe9a4919a56a6b610901f5f23660be4095c9d91cdf0dd260775d1f11ec2a7dc",
    "verdictHash": "76248138724076c0df1580656c90db3e61f8e1b8f18884529d755a2c96288df9",
    "mutationWorkHash": "140bedbf9c3f6d56a9846d2ba7088798683f4da0c248231336e6a05679e4fdfe"
  },
  {
    "caseHash": "3c172943bb426bc6019caf50cf2953ec987db0361dc1d831003d6433280d2c5a",
    "receiptHash": "1ff27ef7fb933d598fd92670e351e94d93dd5ad6fd61502c7464e2290039ab24",
    "observedHash": "7f2b319b7e397f333140eb02780ae4cc82e20c64295f8ee491d954f36d5efda5",
    "requestOrderHash": "60812e0a8c5d5af8f77e20929fa48741a78560192bdf3a08ca795b4677b65293",
    "verdictHash": "76248138724076c0df1580656c90db3e61f8e1b8f18884529d755a2c96288df9",
    "mutationWorkHash": "140bedbf9c3f6d56a9846d2ba7088798683f4da0c248231336e6a05679e4fdfe"
  },
  {
    "caseHash": "14f2fce2492c885c90e65571f30804d5e78417e6d07752d94fd82187a91f33e8",
    "receiptHash": "f3f66e78af2875bf2b801ba3a683a0f22a7ad83fdbaa6ccd6732a1eb5d436cca",
    "observedHash": "2696e1a3558b832e34c48336726b18594ffc140920afb9d63ab574f6d11a7834",
    "requestOrderHash": "60812e0a8c5d5af8f77e20929fa48741a78560192bdf3a08ca795b4677b65293",
    "verdictHash": "c70f3b5f2ed9e2dec6455d18690126b6a1eed483bef9f4cd4b35e66d3ecbcc48",
    "mutationWorkHash": "140bedbf9c3f6d56a9846d2ba7088798683f4da0c248231336e6a05679e4fdfe"
  }
]
```

## Validation hashes

```json
[
  {
    "commandHash": "be2583449094616aed235636faf24fa0fd0d4258334f3276bb8fe4a02a831108",
    "exitCode": 0
  },
  {
    "commandHash": "b59e6af7b8e1fb719b7bf4e2508c5e7acaf9a88c9e2c25a957af7f825a971d16",
    "exitCode": 0,
    "passCount": 4,
    "failCount": 0
  },
  {
    "commandHash": "464bdbe9f24bae5f20433f1d662b188faef49d72e776c71d50e02286d7e37018",
    "exitCode": 0,
    "passCount": 3,
    "failCount": 0
  },
  {
    "commandHash": "300e7bda975ce6ba7dc345b6493b5ae8499365cfbf902fdc7cf07ab715b900a7",
    "exitCode": 0,
    "passCount": 3,
    "failCount": 0
  },
  {
    "commandHash": "c40e2970f140b648789d5982a4086e741d03f66982011f7b1013fa885b06c4bf",
    "exitCode": 1,
    "reasonHash": "fddff9a19337fa26713d5dbc74249dbd78faaffd8c3efb434a468ebbf696a73c"
  },
  {
    "commandHash": "af9b52fba7b7c67b65d0181e6680a430926c4a11754f108d533a921c84b5b21e",
    "exitCode": 0
  },
  {
    "commandHash": "466c2f308b48c7661d646fdd068fbecea974c665fe65dbf8ed508f224180ce0b",
    "exitCode": 0
  },
  {
    "commandHash": "3bf6bd343dba2f48612670fd9472bdeee1868f1648edb72bb8e286b9d6038ebd",
    "exitCode": 0
  }
]
```

## Boundary

This is deterministic local support evidence only. Integration recommendation:
**NO-GO** for release movement from this slice alone.
