import { MongoClient } from 'mongodb';
import { Client } from '@elastic/elasticsearch';

const client = new Client({ node: 'http://elasticsearch-service:9200' });
const mongo = new MongoClient('mongodb://mongo:admin@mongodb-service:27017');

async function run() {
  await mongo.connect();
  const collection = mongo.db('products').collection('products');
  
  // Observa mudanças na coleção de produtos
  const changeStream = collection.watch();
  
  changeStream.on('change', async (next) => {
    if (next.operationType === 'insert') {
      await client.index({
        index: 'products',
        document: next.fullDocument
      });
      console.log('✅ Produto indexado no Elasticsearch!');
    }
  });
}

run();